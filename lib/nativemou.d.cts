import type {
  MDBX_BorrowedView as BorrowedView,
  MDBXQueryOperand as QueryOperand,
  MDBXQueryRow as QueryRow,
  MDBXQueryBulk as QueryBulk,
  MDBXQueryBulkField as QueryBulkField,
  MDBXQueryBulkResult as QueryBulkResult,
  MDBX_Native
} from "./types";

declare const native: MDBX_Native;

// MDBXMOU-0001-S3-M2: expose the public type through the `export =` entrypoint.
declare namespace native {
  type MDBX_BorrowedView = BorrowedView;
  type MDBXQueryOperand = QueryOperand;
  type MDBXQueryRow = QueryRow;
  type MDBXQueryBulk = QueryBulk;
  type MDBXQueryBulkField = QueryBulkField;
  type MDBXQueryBulkResult = QueryBulkResult;
}

export = native;
