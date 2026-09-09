-- Add "Другое" as a category, available for both item types that carry a
-- category (Мелкий товар, КГТ; Шредер rows have no category at all).
alter table public.intake_submissions
    drop constraint intake_submissions_category_check;

alter table public.intake_submissions
    add constraint intake_submissions_category_check
        check (category is null or category in (
            'Одежда', 'Обувь', 'Косметика', 'Бытовая химия', 'Мебель',
            'Электроника', 'Ювелирка', 'Для авто', 'Для животных', 'Посуда',
            'Еда', 'Посылка', 'Другое'
        ));
