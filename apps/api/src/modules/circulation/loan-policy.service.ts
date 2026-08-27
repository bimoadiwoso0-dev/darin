import { Injectable } from '@nestjs/common';
import { ERROR_CODES, SETTING_KEYS, addDays, daysBetween, endOfDay } from '@darin/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

/** قوانین مؤثر برای یک عضو مشخص. */
export interface EffectivePolicy {
  maxLoans: number;
  loanDays: number;
  maxRenewals: number;
  renewalDays: number;
  maxReservations: number;
  dailyFineAmount: number;
  maxFinePerLoan: number;
  gracePeriodDays: number;
  canReserve: boolean;
  blockIfOverdue: boolean;
  blockIfUnpaidFines: boolean;
  unpaidFineThreshold: number;
  reservationHoldDays: number;
  reservationBlocksRenewal: boolean;
}

export interface PolicyViolation {
  code: string;
  message: string;
  /** آیا کاربر دارای مجوز `loans.override` می‌تواند از این محدودیت عبور کند؟ */
  overridable: boolean;
}

/**
 * قوانین امانت (قانون ۶۷).
 *
 * هیچ عدد جادویی در کد امانت وجود ندارد؛ همه چیز از این سرویس خوانده می‌شود.
 * ترتیب اولویت: **نوع عضویت** > **تنظیمات عمومی کتابخانه**.
 *
 * فلسفه: قوانین «هشدار قابل عبور» را از «ممنوعیت مطلق» جدا می‌کنند. مثلاً
 * رسیدن به سقف امانت را یک کتابدار مجاز می‌تواند نادیده بگیرد (گاهی لازم
 * است)، اما امانت دادن نسخه‌ای که در دست شخص دیگری است هرگز مجاز نیست.
 */
@Injectable()
export class LoanPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async forMember(memberId: string): Promise<EffectivePolicy> {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { membershipType: true },
    });
    return this.merge(member?.membershipType ?? null);
  }

  /** قوانین پیش‌فرض کتابخانه، بدون در نظر گرفتن نوع عضویت. */
  defaults(): EffectivePolicy {
    return this.merge(null);
  }

  private merge(type: {
    maxLoans: number | null;
    loanDays: number | null;
    maxRenewals: number | null;
    maxReservations: number | null;
    dailyFineAmount: { toString(): string } | null;
    canReserve: boolean;
  } | null): EffectivePolicy {
    return {
      maxLoans: type?.maxLoans ?? this.settings.get(SETTING_KEYS.LOAN_MAX_ITEMS),
      loanDays: type?.loanDays ?? this.settings.get(SETTING_KEYS.LOAN_PERIOD_DAYS),
      maxRenewals: type?.maxRenewals ?? this.settings.get(SETTING_KEYS.LOAN_MAX_RENEWALS),
      renewalDays: this.settings.get(SETTING_KEYS.LOAN_RENEWAL_DAYS),
      maxReservations:
        type?.maxReservations ?? this.settings.get(SETTING_KEYS.RESERVATION_MAX_PER_MEMBER),
      dailyFineAmount:
        type?.dailyFineAmount != null
          ? Number(type.dailyFineAmount.toString())
          : this.settings.get(SETTING_KEYS.FINE_DAILY_AMOUNT),
      maxFinePerLoan: this.settings.get(SETTING_KEYS.FINE_MAX_PER_LOAN),
      gracePeriodDays: this.settings.get(SETTING_KEYS.LOAN_GRACE_PERIOD_DAYS),
      canReserve: type?.canReserve ?? true,
      blockIfOverdue: this.settings.get(SETTING_KEYS.LOAN_BLOCK_IF_OVERDUE),
      blockIfUnpaidFines: this.settings.get(SETTING_KEYS.LOAN_BLOCK_IF_UNPAID_FINES),
      unpaidFineThreshold: this.settings.get(SETTING_KEYS.LOAN_UNPAID_FINE_THRESHOLD),
      reservationHoldDays: this.settings.get(SETTING_KEYS.RESERVATION_HOLD_DAYS),
      reservationBlocksRenewal: this.settings.get(SETTING_KEYS.RESERVATION_BLOCKS_RENEWAL),
    };
  }

  /**
   * بررسی صلاحیت عضو برای امانت گرفتن.
   *
   * همه محدودیت‌ها با هم بررسی و برگردانده می‌شوند — نه اینکه با اولین مورد
   * متوقف شویم. کتابدار باید یک‌جا ببیند «این عضو ۳ مشکل دارد»، نه اینکه سه
   * بار تلاش کند و هر بار یک پیام بگیرد.
   */
  async checkMemberEligibility(
    memberId: string,
    additionalItems: number,
    policy?: EffectivePolicy,
  ): Promise<PolicyViolation[]> {
    const effective = policy ?? (await this.forMember(memberId));
    const violations: PolicyViolation[] = [];

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { status: true, expiresAt: true, deletedAt: true },
    });

    if (!member || member.deletedAt) {
      return [{
        code: ERROR_CODES.NOT_FOUND,
        message: 'عضو یافت نشد.',
        overridable: false,
      }];
    }

    // وضعیت عضویت — مسدود و تعلیق قابل نادیده‌گرفتن نیستند
    if (member.status === 'BLOCKED' || member.status === 'SUSPENDED') {
      violations.push({
        code: ERROR_CODES.MEMBER_NOT_ACTIVE,
        message:
          member.status === 'BLOCKED'
            ? 'عضویت این شخص مسدود شده است.'
            : 'عضویت این شخص تعلیق شده است.',
        overridable: false,
      });
    } else if (member.status === 'INACTIVE') {
      violations.push({
        code: ERROR_CODES.MEMBER_NOT_ACTIVE,
        message: 'عضویت این شخص غیرفعال است.',
        overridable: true,
      });
    }

    if (member.expiresAt && member.expiresAt < new Date()) {
      violations.push({
        code: ERROR_CODES.MEMBER_MEMBERSHIP_EXPIRED,
        message: 'اعتبار عضویت به پایان رسیده است. ابتدا عضویت را تمدید کنید.',
        overridable: true,
      });
    }

    const [openLoans, overdueCount, debt] = await Promise.all([
      this.prisma.loan.count({
        where: { memberId, status: { in: ['ACTIVE', 'OVERDUE'] } },
      }),
      this.prisma.loan.count({ where: { memberId, status: 'OVERDUE' } }),
      this.outstandingDebt(memberId),
    ]);

    if (openLoans + additionalItems > effective.maxLoans) {
      violations.push({
        code: ERROR_CODES.MEMBER_LOAN_LIMIT_REACHED,
        message: `سقف مجاز ${effective.maxLoans} کتاب است؛ این عضو در حال حاضر ${openLoans} کتاب دارد.`,
        overridable: true,
      });
    }

    if (effective.blockIfOverdue && overdueCount > 0) {
      violations.push({
        code: ERROR_CODES.MEMBER_HAS_OVERDUE,
        message: `این عضو ${overdueCount} کتاب دیرکرددار دارد.`,
        overridable: true,
      });
    }

    if (effective.blockIfUnpaidFines && debt > effective.unpaidFineThreshold) {
      violations.push({
        code: ERROR_CODES.MEMBER_HAS_UNPAID_FINES,
        message: `بدهی این عضو ${debt.toLocaleString('fa-IR')} است و از سقف مجاز (${effective.unpaidFineThreshold.toLocaleString('fa-IR')}) بیشتر است.`,
        overridable: true,
      });
    }

    return violations;
  }

  /** مجموع بدهی تسویه‌نشده عضو. */
  async outstandingDebt(memberId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ debt: string | null }>>`
      SELECT sum("amount" - "paidAmount")::text AS debt
        FROM fines
       WHERE "memberId" = ${memberId}::uuid
         AND "status" IN ('UNPAID', 'PARTIALLY_PAID')
    `;
    return Number(rows[0]?.debt ?? 0);
  }

  /**
   * محاسبه موعد بازگشت.
   * همیشه به **پایان روز** گرد می‌شود: کتابی که ساعت ۹ صبح امانت داده شده و
   * کتابی که ساعت ۶ عصر همان روز، هر دو تا پایان همان روزِ سررسید فرصت دارند.
   */
  computeDueDate(loanedAt: Date, days: number): Date {
    return endOfDay(addDays(loanedAt, days));
  }

  /**
   * محاسبه جریمه دیرکرد.
   *
   * `gracePeriodDays` مهلت ارفاق است: اگر ۲ باشد، تا ۲ روز تأخیر جریمه ندارد
   * و از روز سوم، جریمه برای **همه** روزهای تأخیر محاسبه می‌شود.
   */
  computeFine(
    dueAt: Date,
    returnedAt: Date,
    policy: EffectivePolicy,
  ): { overdueDays: number; amount: number } {
    const overdueDays = daysBetween(dueAt, returnedAt);
    if (overdueDays <= 0) return { overdueDays: 0, amount: 0 };
    if (overdueDays <= policy.gracePeriodDays) return { overdueDays, amount: 0 };

    const raw = overdueDays * policy.dailyFineAmount;
    // سقف جریمه از رقم‌های نجومی برای کتابی که سال‌ها برنگشته جلوگیری می‌کند
    const amount = policy.maxFinePerLoan > 0 ? Math.min(raw, policy.maxFinePerLoan) : raw;
    return { overdueDays, amount };
  }
}
