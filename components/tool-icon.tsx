import type { Tool } from "../lib/tools";

const icons = {
  merge: "M4 4h6v7H4zM14 4h6v7h-6zM7 11v3l5 3 5-3v-3M12 17v4",
  split: "M7 3h10v7H7zM12 10v4M5 21v-4l7-3 7 3v4M3 21h4m10 0h4",
  organize: "m3 8 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 18l9 4 9-4",
  edit: "M13 3H5v18h14v-8M9 15l2-4 7-7 3 3-7 7-5 1Z",
  create: "M14 3H5v18h14V8l-5-5Zm0 0v5h5M12 11v6m-3-3h6",
  "images-to-pdf": "M3 5h14v11H3zM6 13l3-3 3 3 2-2 3 3m3-6v12H7M7 8h.1",
  "pdf-to-word": "M4 4h11l4 4v12H4zM15 4v4h4M7 12l2 5 2-4 2 4 2-5",
  "word-to-pdf": "M5 3h10l4 4v14H5zM15 3v4h4M8 12h8m-8 4h5",
  protect: "M12 22C9 20 5 18 5 12V5l7-3 7 3v7c0 6-4 8-7 10Zm-3-7h6v-4H9Zm1-4V9a2 2 0 0 1 4 0v2",
};

export function ToolIcon({ tool }: { tool: Tool }) {
  return <span className="tool-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[tool.id]} /></svg></span>;
}
