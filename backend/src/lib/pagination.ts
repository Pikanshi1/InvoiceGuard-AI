
import { z } from "zod";
import type { ParsedQs } from "qs";

export const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type PaginationInput = {
  page: number;
  limit: number;
};

export type PaginatedResponse<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  totalPages: number;
};

export function parsePagination(query: ParsedQs): PaginationInput {
  const parsed = PaginationSchema.parse({
    page: typeof query.page === "string" ? query.page : undefined,
    limit: typeof query.limit === "string" ? query.limit : undefined,
  });

  return { page: parsed.page, limit: parsed.limit };
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  const totalPages = Math.ceil(total / limit);

  return {
    data: items,
    total,
    page,
    limit,
    hasMore: page < totalPages,
    totalPages,
  };
}

export type PaginatedPrismaResult<T> = {
  items: T[];
  total: number;
};

export async function paginateQuery<T>(
  findMany: () => Promise<T[]>,
  count: () => Promise<number>,
  page: number,
  limit: number
): Promise<PaginatedPrismaResult<T>> {
  const [items, total] = await Promise.all([findMany(), count()]);
  return { items, total };
}
