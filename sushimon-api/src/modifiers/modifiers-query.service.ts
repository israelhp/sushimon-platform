import { Inject, Injectable, Logger } from '@nestjs/common';
import { buildSearchPattern } from '../products/product-policy.js';
import {
  buildOfferGroups,
  groupNotFound,
  groupOptions,
  isUnsatisfiable,
  productNotFound,
  toGroupView,
  toPublicGroups,
  toSummaryView,
} from './modifier-policy.js';
import { ModifiersRepository, type ModifierTx } from './modifiers.repository.js';
import type {
  AdminModifierGroupPageView,
  AdminModifierGroupView,
  AdminProductModifiersView,
  PublicModifierGroupView,
} from './modifiers.types.js';

export interface AdminModifierGroupsQuery {
  q?: string;
  active?: boolean;
  page: number;
  pageSize: number;
}

/**
 * Lecturas de modificadores. Exportado para la ficha pública de productos (`ProductsQueryService`) y para el editor.
 * Sin N+1: la lista usa una consulta de página (con conteos agregados) más una de total; la ficha, una consulta.
 */
@Injectable()
export class ModifiersQueryService {
  private readonly logger = new Logger(ModifiersQueryService.name);

  constructor(@Inject(ModifiersRepository) private readonly repo: ModifiersRepository) {}

  async listGroups(query: AdminModifierGroupsQuery): Promise<AdminModifierGroupPageView> {
    const { rows, total } = await this.repo.findGroupPage({
      pattern: buildSearchPattern(query.q),
      ...(query.active !== undefined ? { active: query.active } : {}),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: rows.map(toSummaryView),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Grupo con todas sus opciones (activas e inactivas). `tx` para leer el resultado dentro de una escritura. */
  async getGroup(id: string, tx?: ModifierTx): Promise<AdminModifierGroupView> {
    const summary = await this.repo.findGroupSummary(id, tx);
    if (!summary) throw groupNotFound();
    const options = await this.repo.findOptionsByGroupIds([id], tx);
    return toGroupView(summary, options);
  }

  /** Grupos del producto (activos e inactivos) con opciones: dos consultas como máximo. */
  async getProductModifiers(
    productId: string,
    tx?: ModifierTx,
  ): Promise<AdminProductModifiersView> {
    const summaries = await this.repo.findProductGroupSummaries(productId, tx);
    if (summaries === null) throw productNotFound();
    const options = groupOptions(
      await this.repo.findOptionsByGroupIds(
        summaries.map((s) => s.id),
        tx,
      ),
    );
    return {
      productId,
      groups: summaries.map((s) => toGroupView(s, options.get(s.id) ?? [])),
    };
  }

  /**
   * Ficha pública: solo grupos ofrecibles y opciones activas, en orden. Una consulta. Un grupo ACTIVO insatisfacible
   * (dato inconsistente) se omite con `warn` sin PII; el producto sigue visible.
   */
  async findPublicGroupsForProduct(productId: string): Promise<PublicModifierGroupView[]> {
    const rows = await this.repo.findOffer(productId);
    if (rows === null) return [];
    const groups = buildOfferGroups(rows);
    for (const g of groups) {
      if (isUnsatisfiable(g)) {
        this.logger.warn(
          `Grupo de modificadores activo insatisfacible omitido (group=${g.id}, product=${productId})`,
        );
      }
    }
    return toPublicGroups(groups);
  }
}
