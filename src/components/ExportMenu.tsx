import { Download, FileText, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

interface Props {
  onPdf: () => void;
  onJson?: () => void;
  label?: string;
  size?: "sm" | "default";
  variant?: "default" | "outline" | "ghost";
  disabled?: boolean;
}

export function ExportMenu({ onPdf, onJson, label = "Export", size = "sm", variant = "outline", disabled }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} disabled={disabled}>
          <Download className="mr-1 h-3.5 w-3.5" />{label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onPdf}><FileText className="mr-2 h-4 w-4" />PDF report</DropdownMenuItem>
        {onJson && <DropdownMenuItem onClick={onJson}><Braces className="mr-2 h-4 w-4" />JSON (raw)</DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
