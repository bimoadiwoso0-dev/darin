import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { COPY_STATUS } from '@darin/shared';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { booleanQuery, csvEnumQuery } from '../../common/dto/query.schema';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SearchService } from './search.service';

const copyStatuses = Object.keys(COPY_STATUS) as [string, ...string[]];

const SearchQuerySchema = z.object({
  q: z.string().max(200).optional().default(''),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  sort: z.enum(['relevance', 'title', 'year', 'newest']).optional().default('relevance'),
  publisherId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  seriesId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  donorId: z.string().uuid().optional(),
  language: z.string().max(12).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  copyStatus: csvEnumQuery(copyStatuses),
  availableOnly: booleanQuery,
  overdueOnly: booleanQuery,
  reservedOnly: booleanQuery,
});

@ApiTags('جستجو')
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /** جستجوی سراسری Header — کتاب، عضو، نسخه و قفسه با یک کادر (قانون ۴۴). */
  @Get('global')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'جستجوی سراسری' })
  global(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.search.global(q ?? '', limit ? Number(limit) : 5);
  }

  @Get('suggest')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'پیشنهاد خودکار هنگام تایپ' })
  suggest(@Query('q') q: string) {
    return this.search.suggest(q ?? '');
  }

  @Get('books')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'جستجوی پیشرفته کتاب با فیلترهای ترکیبی' })
  async books(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: z.infer<typeof SearchQuerySchema>,
  ) {
    const { q, page, pageSize, sort, ...filters } = query;
    const result = await this.search.searchBooks(
      q,
      filters,
      { limit: pageSize, offset: (page - 1) * pageSize },
      sort,
    );
    return {
      data: result.hits,
      meta: {
        page,
        pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
        tookMs: result.tookMs,
      },
    };
  }
}
