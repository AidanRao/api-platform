import type { AdContent } from "../../../../src/features/ads/schema";
import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Radix Colors light scales, steps 2 for backgrounds and 12 for text.
const presets = [
  { label: "灰色", backgroundColor: "0xFFF9F9F9", textColor: "0xFF202020" },
  { label: "蓝色", backgroundColor: "0xFFF4FAFF", textColor: "0xFF113264" },
  { label: "绿色", backgroundColor: "0xFFF4FBF6", textColor: "0xFF193B2D" },
  { label: "琥珀色", backgroundColor: "0xFFFEFBE9", textColor: "0xFF4F3422" },
  { label: "红色", backgroundColor: "0xFFFFF7F7", textColor: "0xFF641723" },
  { label: "紫色", backgroundColor: "0xFFFAF8FF", textColor: "0xFF2F265F" },
] as const;

const fields = [
  ["backgroundColor", "背景颜色"],
  ["textColor", "文字颜色"],
] as const;
const defaultOption = "default";

export function bannerColorToCss(argb: string) {
  return `#${argb.slice(4)}${argb.slice(2, 4)}`;
}

function ColorDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-border"
    style={{ backgroundColor: bannerColorToCss(color) }} />;
}

export function TextBannerColors({ content, onChange }: {
  content: AdContent;
  onChange: (patch: Partial<AdContent>) => void;
}) {
  const id = useId();
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map(([field, label]) => {
        const fieldId = `${id}-${field}`;
        const value = content[field];
        return (
          <div key={field} className="space-y-2">
            <Label id={`${fieldId}-label`} htmlFor={fieldId}>{label}</Label>
            <Select value={value ?? defaultOption}
              onValueChange={(color) => onChange({ [field]: color === defaultOption ? undefined : color })}>
              <SelectTrigger id={fieldId} aria-labelledby={`${fieldId}-label`} className="w-full shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                <SelectItem value={defaultOption}><ColorDot color={presets[0][field]} />默认</SelectItem>
                {presets.map((preset) => (
                  <SelectItem key={preset[field]} value={preset[field]}>
                    <ColorDot color={preset[field]} />{preset.label}
                  </SelectItem>
                ))}
                {value && !presets.some((preset) => preset[field] === value) && (
                  <SelectItem value={value}><ColorDot color={value} />已保存的颜色</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
