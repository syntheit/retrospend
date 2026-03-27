"use client";

import type * as React from "react";

import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/ui/sheet";

function ResponsiveDialog({
  ...props
}: React.ComponentProps<typeof Dialog>) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? Sheet : Dialog;
  return <Comp {...props} />;
}

function ResponsiveDialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogTrigger>) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? SheetTrigger : DialogTrigger;
  return <Comp {...props} />;
}

function ResponsiveDialogClose({
  ...props
}: React.ComponentProps<typeof DialogClose>) {
  const isMobile = useIsMobile();
  const Comp = isMobile ? SheetClose : DialogClose;
  return <Comp {...props} />;
}

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton,
  ...props
}: React.ComponentProps<typeof DialogContent> & {
  showCloseButton?: boolean;
}) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[85dvh] overflow-y-auto rounded-t-xl",
          className,
        )}
        {...(props as React.ComponentProps<typeof SheetContent>)}
      >
        <div className="mx-auto mt-2 mb-4 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        {children}
      </SheetContent>
    );
  }

  return (
    <DialogContent className={className} showCloseButton={showCloseButton} {...props}>
      {children}
    </DialogContent>
  );
}

function ResponsiveDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <SheetHeader className={className} {...props} />;
  }
  return <DialogHeader className={className} {...props} />;
}

function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <SheetFooter className={className} {...props} />;
  }
  return <DialogFooter className={className} {...props} />;
}

function ResponsiveDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <SheetTitle className={className} {...props} />;
  }
  return <DialogTitle className={className} {...props} />;
}

function ResponsiveDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return <SheetDescription className={className} {...props} />;
  }
  return <DialogDescription className={className} {...props} />;
}

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
};
