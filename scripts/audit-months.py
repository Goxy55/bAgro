"""Extract calendar evidence without executing workbook code or changing the XLSX."""
from pathlib import Path
from fractions import Fraction
from collections import defaultdict
import ast, hashlib, json, re
import openpyxl

ROOT=Path(__file__).resolve().parents[1]
book=ROOT/'source/izvor-2017.xlsx'
inventory=json.loads((ROOT/'source/inventory.json').read_text())
sha=hashlib.sha256(book.read_bytes()).hexdigest()
assert sha==inventory['sha256']
wb=openpyxl.load_workbook(book,data_only=False)
aux=wb['Zalihe na parceli']
targets={(c['sheet'],i['id']) for c in inventory['cards'] for i in c['items']}
cache={}

def add(a,b,sign=1):
 out=dict(a)
 for k,v in b.items():out[k]=out.get(k,Fraction(0))+sign*v
 return {k:v for k,v in out.items() if v}
def scale(a,n):return {k:v*n for k,v in a.items() if v*n}
def linear(sheet,cell,stack=()):
 key=(sheet,cell)
 if key in targets:return {key:Fraction(1)}
 if key in cache:return cache[key]
 if key in stack or len(stack)>100:raise ValueError('Ciklična ili preduga zavisnost')
 value=wb[sheet][cell].value
 if value is None:return {}
 if isinstance(value,(int,float)):return {('', 'constant'):Fraction(str(value))} if value else {}
 if not isinstance(value,str) or not value.startswith('='):raise ValueError('Neprepoznata formula')
 refs={}
 pattern=r"(?:'([^']+)'!|([A-Za-zČĆŠŽĐčćšžđ][\w .-]*)!)?(\$?[A-Z]{1,3}\$?\d+)"
 def ref(m):
  name='R'+str(len(refs));refs[name]=(m[1] or m[2] or sheet,m[3].replace('$',''));return name
 expr=re.sub(pattern,ref,value[1:])
 tree=ast.parse(expr,mode='eval')
 if len(list(ast.walk(tree)))>1000:raise ValueError('Prevelika formula')
 def visit(n):
  if isinstance(n,ast.Expression):return visit(n.body)
  if isinstance(n,ast.Name) and n.id in refs:return linear(*refs[n.id],stack+(key,))
  if isinstance(n,ast.Constant) and type(n.value) in (int,float):return {('', 'constant'):Fraction(str(n.value))}
  if isinstance(n,ast.UnaryOp) and isinstance(n.op,(ast.UAdd,ast.USub)):return scale(visit(n.operand),-1 if isinstance(n.op,ast.USub) else 1)
  if isinstance(n,ast.BinOp):
   a,b=visit(n.left),visit(n.right)
   if isinstance(n.op,ast.Add):return add(a,b)
   if isinstance(n.op,ast.Sub):return add(a,b,-1)
   if isinstance(n.op,ast.Mult):
    if not b or set(b)=={('', 'constant')}:return scale(a,b.get(('', 'constant'),0))
    if not a or set(a)=={('', 'constant')}:return scale(b,a.get(('', 'constant'),0))
   if isinstance(n.op,ast.Div) and set(b)=={('', 'constant')} and b[('', 'constant')]:return scale(a,1/b[('', 'constant')])
  raise ValueError('Dozvoljena je samo deklarativna linearna aritmetika')
 result=visit(tree);cache[key]=result;return result

aux_rows=[]
for r in range(4,aux.max_row+1):
 if not aux[f'B{r}'].value:continue
 vectors=[];errors=[]
 for month in range(1,13):
  cell=f'{openpyxl.utils.get_column_letter(2*month+1)}{r}'
  try:vectors.append(linear(aux.title,cell))
  except Exception as e:vectors.append({});errors.append({'cell':cell,'message':str(e)})
 weights=defaultdict(dict)
 for month,vector in enumerate(vectors,1):
  prior=vectors[(month-2)%12]
  # Cumulative amounts may restart for a new crop. Record additions, never sum balances.
  restart=bool(vector) and any(prior.get(k,0)>vector.get(k,0) for k in prior) and all(vector.get(k,0)<=prior.get(k,0) for k in vector)
  for key,value in vector.items():
   if key not in targets:continue
   delta=value if restart else value-prior.get(key,0)
   if delta>0:weights[key][month]=delta
 aux_rows.append({'row':r,'name':aux[f'B{r}'].value,'weights':weights,'errors':errors})

cards=[]
for c in inventory['cards']:
 if c['basis']!='ha':continue
 keys={(c['sheet'],i['id']) for i in c['items']}
 scores=[(len(keys & set(a['weights'])),a) for a in aux_rows]
 best=max((s for s,a in scores),default=0)
 matches=[a for score,a in scores if score==best and score]
 evidence=matches[0] if len(matches)==1 else None
 missing=[]
 sheet=wb[c['sheet']]
 start=int(re.search(r'\d+',c['range'].split(':')[0])[0]);stop=int(re.search(r'\d+',c['range'].split(':')[1])[0])
 known={i['id'] for i in c['items']}
 isnum=lambda value:isinstance(value,(int,float)) or isinstance(value,str) and value.startswith('=')
 for row in range(start,stop+1):
  label=sheet[f'B{row}'].value
  if isinstance(label,str) and isnum(sheet[f'E{row}'].value) and isnum(sheet[f'F{row}'].value) and f'F{row}' not in known:
   missing.append({'id':f'F{row}','name':label,'month':sheet[f'C{row}'].value,'quantity':sheet[f'E{row}'].value,'price':sheet[f'D{row}'].value,'total':sheet[f'F{row}'].value,'reason':'Red sa brojem ili formulom nije u ranijem normalizovanom modelu; ne dodavati ga prećutno aktivnoj istoriji.'})
 items=[];last=None
 for i in c['items']:
  raw=i.get('month')
  row=int(re.search(r'\d+',i['id'])[0])
  if raw is not None and str(raw).strip():last={'value':str(raw).strip(),'cell':f'C{row}'}
  weights=evidence['weights'].get((c['sheet'],i['id']),{}) if evidence else {}
  issues=[]
  if weights and sum(weights.values())!=1:issues.append('Pomoćni raspored ne daje zbir 1; ne koristiti automatski.')
  items.append({'id':i['id'],'name':i['name'],'quantityCell':i.get('quantityCell'),'monthCell':f'C{row}','originalMonth':raw,'context':last.copy() if last else None,'helperWeights':[{'month':m,'numerator':str(v.numerator),'denominator':str(v.denominator),'cell':f'{openpyxl.utils.get_column_letter(2*m+1)}{evidence["row"]}'} for m,v in sorted(weights.items())],'issues':issues})
 cards.append({'templateId':c['id'],'sheet':c['sheet'],'name':c['name'],'helperRow':evidence['row'] if evidence else None,'helperErrors':evidence['errors'] if evidence else [],'missingSourceRows':missing,'items':items})
result={'sourceHash':sha,'auxiliarySheet':aux.title,'method':'Deklarativne linearne zavisnosti i razlike kumulativnih stanja; bez izvršavanja formula. Kolona C ostaje primarni raspored; pomoćne raspodele zahtevaju proveru zbira i saglasnosti meseci.','cards':cards}
path=ROOT/'source/monthly-calendar-audit.json'
path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'path':str(path.relative_to(ROOT)),'cards':len(cards),'items':sum(len(c['items']) for c in cards),'blankMonths':sum(i['originalMonth'] is None for c in cards for i in c['items'])}))
for c in cards:
 if c['templateId'] in ['s0-B36','s0-B103','s0-B243','s0-B206']:
  print(json.dumps({'culture':c['name'],'helperRow':c['helperRow'],'examples':[i for i in c['items'] if i['id'] in ['F57','F224','F225','F226','F227','F107']]},ensure_ascii=False))
