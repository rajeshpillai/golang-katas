import MarkdownContent from "../common/markdown-content";

interface DescriptionPanelProps {
  description: string;
}

export default function DescriptionPanel(props: DescriptionPanelProps) {
  return (
    <div
      class="flex-1 overflow-y-auto p-6"
      style={{ "background-color": "var(--bg-primary)" }}
    >
      <MarkdownContent content={props.description} />
    </div>
  );
}
