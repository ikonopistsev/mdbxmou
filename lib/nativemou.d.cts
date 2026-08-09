import type {
  MDBX_BorrowedView as BorrowedView,
  MDBX_Native
} from "./types";

declare const native: MDBX_Native;

// MDBXMOU-0001-S3-M2: expose the public type through the `export =` entrypoint.
declare namespace native {
  type MDBX_BorrowedView = BorrowedView;
}

export = native;
