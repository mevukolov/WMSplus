-- Разовая чистка: все короба, у которых disassembled_at уже проставлен (до
-- этого изменения ничего не освобождало полку), теряют shelf_id задним
-- числом -- иначе они бы остались висеть на стеллажах, несмотря на новый
-- фильтр в loadZone, до тех пор пока их кто-то вручную не тронет.
update public.wms_no_shk_boxes
set shelf_id = null
where disassembled_at is not null
  and shelf_id is not null;
