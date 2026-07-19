import { useAtomValue } from "jotai"
import { Toaster as Sonner } from "sonner"
import { resolvedThemeAtom } from "@/atoms/theme"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useAtomValue(resolvedThemeAtom)

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:rounded-xl",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-[hsl(var(--brand-soft))] group-[.toast]:text-[hsl(var(--brand-soft-foreground))] group-[.toast]:hover:bg-[hsl(var(--brand-soft-hover))]",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
