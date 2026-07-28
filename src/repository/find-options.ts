export interface FindOptions {
  where?: Record<string, unknown>;
  order?: Record<string, 'ASC' | 'DESC'>;
  limit?: number;
  offset?: number;
  select?: string[];
  relations?: string[];
}
