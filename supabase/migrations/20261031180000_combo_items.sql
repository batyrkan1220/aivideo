-- Combo photos are uploaded in the combo editor: each becomes a hidden photo template (kind 'combo_item').
alter table templates drop constraint templates_kind_check;
alter table templates add constraint templates_kind_check check (kind = any (array['catalog','custom','custom_photo','combo','combo_item']));
