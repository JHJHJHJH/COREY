# Third-Party Notices

COREY depends on open-source packages distributed under their respective
licenses. The project license covers only COREY's original source.

## Runtime Assets Copied Into `public/`

- `public/workers/thatopen-fragments-worker.mjs` is copied from
  `@thatopen/fragments` 3.4.7, currently MIT licensed.
- `public/wasm/web-ifc.wasm` and `public/wasm/web-ifc-mt.wasm` are copied from
  `web-ifc` 0.0.77, currently MPL-2.0 licensed.

When these packages are upgraded, refresh the copied files and update this
notice if the source package or license changes.

## Direct Production Dependencies

- `@aws-sdk/client-s3`: Apache-2.0
- `@prisma/adapter-pg`: Apache-2.0
- `@prisma/client`: Apache-2.0
- `@thatopen/components`: MIT
- `@thatopen/components-front`: MIT
- `@thatopen/fragments`: MIT
- `exceljs`: MIT
- `lucide-react`: ISC
- `next`: MIT
- `pg`: MIT
- `react`: MIT
- `react-dom`: MIT
- `three`: MIT
- `web-ifc`: MPL-2.0

Development dependencies are also open-source packages. Check each package's
published metadata and license file for authoritative terms.
