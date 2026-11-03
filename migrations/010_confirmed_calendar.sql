-- Business rules explicitly confirmed by the customer on 03.11.2026.
-- Preserve any calendar policy already chosen by the installation's administrator.
INSERT INTO cost_calendar_policies(id,request_id,name,status,policy,author,reason)
SELECT '7a29f362-27cb-4c68-99b0-3439f26617ae','1cb642a7-56ec-47e1-a83c-027639a03966',
 'Potvrđen raspored ulaganja — 03.11.2026.','active',
 '{"inheritMonths":true,"rangeRule":"equal","seasonRule":"cycle","preferAuxiliary":true}'::jsonb,
 'Naručilac — potvrda u razgovoru 03.11.2026.',
 'Potvrđeno: mesec pripadajuće operacije; ravnomerna podela kao rezerva; prednost usaglašene izvorne raspodele; cela sezona kroz dve godine.'
WHERE NOT EXISTS(SELECT 1 FROM cost_calendar_policies WHERE status='active')
ON CONFLICT(id) DO NOTHING;
INSERT INTO audit_log(id,user_id,action,entity,metadata)
SELECT 'd7862749-6bb6-455d-a646-b294ff9d08fa','configuration:customer-confirmed-calendar',
 'calendar_policy_initialize','7a29f362-27cb-4c68-99b0-3439f26617ae',
 '{"confirmedByCustomer":true,"confirmationDate":"2026-11-03","reason":"Četiri izričite poslovne potvrde u razgovoru; nisu test podaci ili cenovnik."}'::jsonb
WHERE EXISTS(SELECT 1 FROM cost_calendar_policies WHERE id='7a29f362-27cb-4c68-99b0-3439f26617ae')
ON CONFLICT(id) DO NOTHING;
