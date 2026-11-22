"use client";

import dynamic from "next/dynamic";

export const CreateTool = dynamic(() => import("./create-workspace").then((module) => module.CreateWorkspace), {
  ssr: false,
  loading: () => <div className="editor" aria-label="Opening document editor"><div className="create-paper"><div className="create-document" /></div></div>,
});
