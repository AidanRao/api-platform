import { textBannerColorSchema, type AdContent, type TextBannerColor } from "../../../../src/features/ads/schema";
import { Label } from "@/components/ui/label";

// Radix Colors light scales. Step 2 is used for backgrounds and step 12 for text.
export const textBannerColors = {
  gray: { label: "灰色", backgroundColor: "#f9f9f9", textColor: "#202020" },
  blue: { label: "蓝色", backgroundColor: "#f4faff", textColor: "#113264" },
  green: { label: "绿色", backgroundColor: "#f4fbf6", textColor: "#193b2d" },
  amber: { label: "琥珀色", backgroundColor: "#fefbe9", textColor: "#4f3422" },
  red: { label: "红色", backgroundColor: "#fff7f7", textColor: "#641723" },
  violet: { label: "紫色", backgroundColor: "#faf8ff", textColor: "#2f265f" },
} satisfies Record<TextBannerColor, { label: string; backgroundColor: string; textColor: string }>;

const fields = { backgroundColor: "背景颜色", textColor: "文字颜色" } as const;

export function TextBannerColors({ content, onChange }: {
  content: AdContent;
  onChange: (patch: Partial<AdContent>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Object.entries(fields).map(([key, label]) => {
        const field = key as keyof typeof fields;
        return (
          <Label key={field} className="block">
            {label}
            <select
              className="mt-2 block h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              value={content[field] ?? ""}
              onChange={(event) => onChange({ [field]: textBannerColorSchema.safeParse(event.target.value).data })}
            >
              <option value="">默认</option>
              {Object.entries(textBannerColors).map(([color, { label }]) => (
                <option key={color} value={color}>{label}</option>
              ))}
            </select>
          </Label>
        );
      })}
    </div>
  );
}
