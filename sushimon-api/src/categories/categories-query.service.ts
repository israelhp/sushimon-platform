import { Inject, Injectable } from '@nestjs/common';
import { CategoriesRepository } from './categories.repository.js';
import type {
  AdminCategoryFilter,
  AdminCategoryListView,
  PublicCategoryView,
  VisibleCategoryDetail,
} from './categories.types.js';
import {
  buildAdminViews,
  buildVisibleTree,
  filterAdminViews,
  visibleIds,
} from './category-policy.js';

/**
 * Lecturas de categorías. Exportado para F11 (productos) y F17 (agregado de tienda): es la única vía para saber qué
 * categorías son VISIBLES (ella y todos sus ancestros activos). Solo lectura; sin productos.
 */
@Injectable()
export class CategoriesQueryService {
  constructor(@Inject(CategoriesRepository) private readonly repo: CategoriesRepository) {}

  /** Árbol anidado de categorías visibles (una sola consulta; el árbol se arma en memoria). */
  async findVisibleTree(): Promise<PublicCategoryView[]> {
    return buildVisibleTree(await this.repo.findAllNodes());
  }

  /** Categoría visible por slug con su cadena de ancestros (raíz → padre) y sus hijas visibles; `null` si no es visible. */
  async findVisibleBySlug(slug: string): Promise<VisibleCategoryDetail | null> {
    const tree = buildVisibleTree(await this.repo.findAllNodes());
    const search = (
      list: readonly PublicCategoryView[],
      path: VisibleCategoryDetail['ancestors'],
    ): VisibleCategoryDetail | null => {
      for (const node of list) {
        if (node.slug === slug) return { category: node, ancestors: path };
        const inner = search(node.children, [
          ...path,
          { id: node.id, slug: node.slug, name: node.name },
        ]);
        if (inner) return inner;
      }
      return null;
    };
    return search(tree, []);
  }

  /** Ids visibles; con `rootId`, solo ese subárbol (vacío si la raíz no es visible o no existe). */
  async getVisibleIds(rootId?: string): Promise<string[]> {
    return visibleIds(await this.repo.findAllNodes(), rootId);
  }

  /** Backoffice: lista plana depth-first con nivel y visibilidad efectiva (todas, activas o no). */
  async listAdmin(filter: AdminCategoryFilter): Promise<AdminCategoryListView> {
    const items = filterAdminViews(buildAdminViews(await this.repo.findAllRows()), filter);
    return { items, total: items.length };
  }
}
