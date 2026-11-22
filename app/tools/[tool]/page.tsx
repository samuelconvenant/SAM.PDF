import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { getTool, tools } from "../../../lib/tools";
import { ToolIcon } from "../../../components/tool-icon";
import { Workspace } from "../../../components/workspace";
import { ConversionWorkspace } from "../../../components/conversion-workspace";
import { CreateTool } from "../../../components/create-tool";

type Props = { params: Promise<{ tool: string }> };
export function generateStaticParams() { return tools.map(({ id }) => ({ tool: id })); }
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tool = getTool((await params).tool);
  return tool ? { title: tool.name, description: tool.description } : {};
}

export default async function ToolPage({ params }: Props) {
  const tool = getTool((await params).tool);
  if (!tool) notFound();
  return (
    <section className="container tool-page">
      <Link href="/#tools" className="back-link"><ArrowLeft size={17} aria-hidden="true" /> All tools</Link>
      <div className="tool-heading">
        <ToolIcon tool={tool} />
        <h1>{tool.name}</h1>
        <p>{tool.description}</p>
      </div>
      {tool.id === "create" ? <CreateTool /> : !("accept" in tool) ? (
        <ConversionWorkspace key={tool.id} kind={tool.id} />
      ) : <>
        <Workspace key={tool.id} tool={tool} />
        <p className="tool-privacy"><ShieldCheck size={17} aria-hidden="true" /> Your files are processed on this device.</p>
      </>}
    </section>
  );
}
