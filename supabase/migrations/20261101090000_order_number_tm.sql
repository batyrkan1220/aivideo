-- Order numbers: TM-100057 instead of TV-… (TrendMe). Existing orders are renamed too.
alter table public.orders alter column public_order_number set default ('TM-' || nextval('order_number_seq')::text);
update public.orders set public_order_number = 'TM-' || substr(public_order_number, 4) where public_order_number like 'TV-%';
