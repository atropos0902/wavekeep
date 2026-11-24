"use client";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";

type Row = Record<string, string | number>;

export function SortTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: { key: string; label: string; number?: boolean }[];
  rows: Row[];
}) {
  const [sorting, setSorting] = useState<SortingState>([{ id: columns.at(-1)!.key, desc: true }]);
  const [shown, setShown] = useState(25);
  const defs = useMemo<ColumnDef<Row>[]>(
    () => columns.map((c) => ({ id: c.key, accessorKey: c.key, header: c.label, meta: c.number ?? false })),
    [columns],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const all = table.getRowModel().rows;
  return (
    <section className="sheet mt-5 overflow-x-auto">
      <h2 className="px-3 pt-3">{title}</h2>
      <table className="cells w-full">
        <thead>
          {table.getHeaderGroups().map((g) => (
            <tr key={g.id}>
              {g.headers.map((h) => {
                const dir = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                  >
                    <button type="button" className="font-semibold" onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}{" "}
                      <span aria-hidden="true">{dir === "asc" ? "↑" : dir === "desc" ? "↓" : ""}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {all.slice(0, shown).map((r) => (
            <tr key={r.id}>
              {r.getVisibleCells().map((c) => (
                <td key={c.id} className={c.column.columnDef.meta ? "num" : "break-words"}>
                  {String(c.getValue())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {all.length > shown && (
        <div className="border-t border-line p-3">
          <button type="button" className="btn" onClick={() => setShown(shown + 50)}>
            Show more ({shown} of {all.length})
          </button>
        </div>
      )}
    </section>
  );
}
