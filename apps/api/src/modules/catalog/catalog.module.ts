import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import {
  CategoriesController,
  PersonsController,
  PublishersController,
  SeriesController,
  TagsAndDonorsController,
} from './reference.controller';
import { ReferenceService } from './reference.service';

@Module({
  imports: [AuditModule],
  controllers: [
    BooksController,
    PersonsController,
    PublishersController,
    CategoriesController,
    SeriesController,
    TagsAndDonorsController,
  ],
  providers: [BooksService, ReferenceService],
  exports: [BooksService, ReferenceService],
})
export class CatalogModule {}
