import { useState } from "react";
import { ipc } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

interface RenameAppDialogProps {
  appId: number;
  currentName: string;
  currentPath: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: () => void;
}

export function RenameAppDialog({
  appId,
  currentName,
  currentPath,
  isOpen,
  onOpenChange,
  onRename,
}: RenameAppDialogProps) {
  const [newName, setNewName] = useState("");

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setNewName(currentName);
    } else {
      setNewName("");
    }
    onOpenChange(open);
  };

  const handleSave = async () => {
    if (!newName.trim()) {
      return;
    }

    try {
      await ipc.app.renameApp({
        appId,
        appName: newName.trim(),
        appPath: currentPath,
      });
      showSuccess("App renamed successfully");
      onRename();
      handleOpenChange(false);
    } catch (error) {
      showError(`Failed to rename app: ${(error as any).toString()}`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename App</DialogTitle>
          <DialogDescription>Enter a new name for this app.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="app-name" className="text-right">
              Name
            </Label>
            <Input
              id="app-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="col-span-3"
              placeholder="Enter app name..."
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSave();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!newName.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
