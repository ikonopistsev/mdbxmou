import type {
  MDBX_BorrowedView as BorrowedView,
  MDBXQueryOperand as QueryOperand,
  MDBX_Native
} from "./types";

declare const native: MDBX_Native;

// MDBXMOU-0001-S3-M2: expose the public type through the `export =` entrypoint.
declare namespace native {
  type MDBX_BorrowedView = BorrowedView;
  type MDBXQueryOperand = QueryOperand;
}

export = native;
