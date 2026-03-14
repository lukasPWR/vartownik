---
applyTo: "src/components/ui/**"
---
# shadcn-vue Components Reference

You are an expert in the shadcn-vue UI component library with Tailwind CSS and Radix Vue.

Apply these rules when adding or using UI components from the `src/components/ui/` directory.

## Installed Components

Components are available in the `src/components/ui/` folder, following the aliases configured in `components.json`.

## Usage

Always import components using the `@/` alias:

```ts
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
```

Example usage:

```vue
<Button variant="outline">Click me</Button>

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card Description</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Card Content</p>
  </CardContent>
  <CardFooter>
    <p>Card Footer</p>
  </CardFooter>
</Card>
```

## Installing New Components

Always use the shadcn-vue CLI to install new components:

```bash
npx shadcn-vue@latest add [component-name]
```

Example — adding the accordion component:

```bash
npx shadcn-vue@latest add accordion
```

> **Important:** `npx shadcn-ui@latest` is deprecated — always use `npx shadcn-vue@latest`.

Available components include: Accordion, Alert, AlertDialog, AspectRatio, Avatar, Calendar, Checkbox, Collapsible, Command, ContextMenu, DataTable, DatePicker, Dropdown Menu, Form, Hover Card, Menubar, Navigation Menu, Popover, Progress, Radio Group, ScrollArea, Select, Separator, Sheet, Skeleton, Slider, Switch, Table, Textarea, Sonner (Toast), Toggle, Tooltip.

## Component Styling

This project uses the **"new-york"** style variant with the **"neutral"** base color and CSS variables for theming, as configured in `components.json`.
