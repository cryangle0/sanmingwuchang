/**
 * Deterministic uniform grid over static map geometry.
 *
 * Cells index item ids by AABB overlap. Construction order is the caller's
 * item order, so query results are stable arrays of ascending item indices.
 */

export interface GridAabb {
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumZ: number;
  readonly maximumZ: number;
}

export class StaticSpatialGrid {
  private readonly cellSizeMm: number;
  private readonly originX: number;
  private readonly originZ: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly cells: number[][];
  private readonly visitMarks: Uint32Array;
  private visitToken = 0;

  constructor(bounds: GridAabb, cellSizeMm: number, items: readonly GridAabb[]) {
    this.cellSizeMm = cellSizeMm;
    this.originX = bounds.minimumX;
    this.originZ = bounds.minimumZ;
    this.columns = Math.max(1, Math.ceil((bounds.maximumX - bounds.minimumX) / cellSizeMm));
    this.rows = Math.max(1, Math.ceil((bounds.maximumZ - bounds.minimumZ) / cellSizeMm));
    this.cells = Array.from({ length: this.columns * this.rows }, () => []);
    this.visitMarks = new Uint32Array(items.length);

    items.forEach((item, itemIndex) => {
      this.forEachCellInRange(item, (cellIndex) => {
        (this.cells[cellIndex] as number[]).push(itemIndex);
      });
    });
  }

  /** Item indices whose AABB may reach the query AABB; ascending and unique. */
  query(range: GridAabb): number[] {
    const result: number[] = [];
    this.forEachUniqueItem(range, (itemIndex) => {
      result.push(itemIndex);
    });
    return result.sort((left, right) => left - right);
  }

  /**
   * Visits each candidate item once without allocating a Set.
   *
   * Cell traversal order is an implementation detail and is not sorted by
   * item index. Callers that need the stable first item must track the
   * smallest matching index themselves. Returning true stops the traversal.
   */
  forEachUniqueItem(range: GridAabb, visit: (itemIndex: number) => unknown): void {
    const token = this.nextVisitToken();
    let stopped = false;
    this.forEachCellInRange(range, (cellIndex) => {
      if (stopped) {
        return;
      }
      for (const itemIndex of this.cells[cellIndex] as number[]) {
        if (this.visitMarks[itemIndex] === token) {
          continue;
        }
        this.visitMarks[itemIndex] = token;
        if (visit(itemIndex) === true) {
          stopped = true;
          return;
        }
      }
    });
  }

  private forEachCellInRange(range: GridAabb, visit: (cellIndex: number) => void): void {
    const firstColumn = this.clampColumn(
      Math.floor((range.minimumX - this.originX) / this.cellSizeMm),
    );
    const lastColumn = this.clampColumn(
      Math.floor((range.maximumX - this.originX) / this.cellSizeMm),
    );
    const firstRow = this.clampRow(Math.floor((range.minimumZ - this.originZ) / this.cellSizeMm));
    const lastRow = this.clampRow(Math.floor((range.maximumZ - this.originZ) / this.cellSizeMm));
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        visit(row * this.columns + column);
      }
    }
  }

  private nextVisitToken(): number {
    this.visitToken += 1;
    if (this.visitToken > 0xffff_ffff) {
      this.visitMarks.fill(0);
      this.visitToken = 1;
    }
    return this.visitToken;
  }

  private clampColumn(column: number): number {
    return Math.min(this.columns - 1, Math.max(0, column));
  }

  private clampRow(row: number): number {
    return Math.min(this.rows - 1, Math.max(0, row));
  }
}
