interface ResizeHandleProps {
  onMouseDown: (e: MouseEvent) => void;
}

export default function ResizeHandle(props: ResizeHandleProps) {
  return (
    <div
      class="w-[5px] cursor-col-resize shrink-0 transition-colors duration-150"
      style={{
        "background-color": "var(--handle-bg)",
      }}
      onMouseDown={props.onMouseDown}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "var(--handle-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.backgroundColor = "var(--handle-bg)";
      }}
    />
  );
}
