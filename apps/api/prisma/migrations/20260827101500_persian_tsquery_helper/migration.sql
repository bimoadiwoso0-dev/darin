-- ───────────────────────────────────────────────────────────────────────────
--  ساخت امن tsquery از ورودی خام کاربر
--
--  چرا لازم است: الحاق ساده `persian_normalize(x) || ':*'` برای عبارت چندکلمه‌ای
--  خطای نحوی می‌دهد (`دیوان حافظ:*` معتبر نیست) و ورودی کاربر می‌تواند شامل
--  عملگرهای tsquery (`&`, `|`, `!`, `<->`) باشد.
--
--  این تابع ورودی را به توکن می‌شکند، هر توکن را پیشوندی می‌کند و با AND
--  ترکیب می‌کند. معادل TypeScript آن `buildPrefixTsQuery()` در
--  packages/shared/src/persian/normalize.ts است.
--
--    persian_tsquery('ديوان حافظ')  →  'دیوان':* & 'حافظ':*
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION persian_tsquery(input text)
RETURNS tsquery
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $fn$
DECLARE
  tokens text[];
  parts  text[] := ARRAY[]::text[];
  tok    text;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  -- حداکثر ۱۲ توکن تا یک عبارت خیلی طولانی کوئری را سنگین نکند
  tokens := (string_to_array(persian_normalize(input), ' '))[1:12];

  FOREACH tok IN ARRAY coalesce(tokens, ARRAY[]::text[]) LOOP
    IF length(tok) > 0 THEN
      -- quote_literal مقدار را ایمن می‌کند؛ عملگرهای tsquery در نرمال‌سازی
      -- حذف شده‌اند اما این لایه دوم دفاع است.
      parts := parts || (quote_literal(tok) || ':*');
    END IF;
  END LOOP;

  IF cardinality(parts) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN to_tsquery('simple', array_to_string(parts, ' & '));
END;
$fn$;

COMMENT ON FUNCTION persian_tsquery(text) IS
  'ورودی خام کاربر را به tsquery پیشوندی امن تبدیل می‌کند. معادل buildPrefixTsQuery() در packages/shared.';
