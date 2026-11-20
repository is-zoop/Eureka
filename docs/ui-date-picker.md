# 日期选择器

公共组件位于 `components/ui/date-picker.tsx`，按 [shadcn Base UI Date Picker](https://ui.shadcn.com/docs/components/base/date-picker) 的组合方式实现：`Popover` + `Calendar`。基础组件分别位于 `components/ui/popover.tsx` 和 `components/ui/calendar.tsx`，可独立复用；日历基于 React DayPicker，弹出层基于 Base UI。

```tsx
import { DatePicker } from "@/components/ui/date-picker";

<DatePicker
  id="report-date"
  value={date}
  onValueChange={setDate}
  calendarLabel="从日历选择报表日期"
  disabled={saving}
/>
```

`value` 与 `onValueChange` 使用日期字符串 `yyyy-mm-dd`，空值为 `""`。支持手动输入、日历选择、月份／年份切换和键盘操作；选择后关闭日历。日期按本地日历解析和格式化，不转换为 UTC 时间。非法或尚未输入完成的文本不作为日历选中日期，调用页面继续负责表单校验。

组件根据当前应用语言显示中英文日历，使用全局主题颜色和圆角；弹出层在配置弹窗上方显示。`disabled` 和 `readOnly` 同时限制输入与日历。自动化的相对日期默认值继续由 `features/automation/shared/automation-form.ts` 在启用时计算，然后传入此组件。

旧的 `components/ui/date-input.tsx` 保留为兼容导出；新代码直接使用 `DatePicker`。
