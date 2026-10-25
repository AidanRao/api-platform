import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

const plugins = [remarkGfm];
export function MarkdownPreview({ content }: { content: string }) {
  return <div className="markdown-preview"><Markdown remarkPlugins={plugins} skipHtml>{content}</Markdown></div>;
}
