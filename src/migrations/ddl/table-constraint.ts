export interface TableKeyConstraintState {
  readonly columns: string[];
}

export interface TableUniqueConstraintState {
  readonly name: string | null;
  readonly columns: string[];
}
