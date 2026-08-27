import { Link, useLocation } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';
import { Button, Card, EmptyState } from '@/components/ui';

/** صفحه یافت‌نشده — مسیر اشتباه یا رکورد حذف‌شده. */
export function NotFoundPage() {
  const location = useLocation();
  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        icon={<FileQuestion className="size-6" />}
        title="این صفحه وجود ندارد"
        description={`نشانی «${location.pathname}» در سامانه تعریف نشده است. ممکن است لینک قدیمی باشد یا رکورد حذف شده باشد.`}
        action={
          <Button variant="primary" onClick={() => { window.location.href = '/'; }}>
            بازگشت به داشبورد
          </Button>
        }
      />
      <p className="border-t border-border px-4 py-3 text-center text-xs text-content-muted">
        یا از <Link to="/" className="text-primary hover:underline">منوی کناری</Link> بخش موردنظر را انتخاب کنید.
      </p>
    </Card>
  );
}
