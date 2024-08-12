import { useCallback, useRef, useState } from "react";
import Header from "../shared/Header";
import { useTheme } from "../shared/theme";
import { default as Editor } from "./Editor";
import initRedKnot, {
  Workspace,
  Settings,
  TargetVersion,
  FileHandle,
} from "./red_knot_wasm";
import { loader } from "@monaco-editor/react";
import { setupMonaco } from "../shared/setupMonaco";
import { Panel, PanelGroup } from "react-resizable-panels";
import { Files } from "./Files";
import { persist, restore } from "./persist";

type CurrentFile = {
  handle: FileHandle;
  content: string;
};

export type FileIndex = {
  [name: string]: FileHandle;
};

export default function Chrome() {
  const initPromise = useRef<null | Promise<void>>(null);
  const [workspace, setWorkspace] = useState<null | Workspace>(null);

  const [files, setFiles] = useState<FileIndex>(Object.create(null));

  // The revision gets incremented everytime any persisted state changes.
  const [revision, setRevision] = useState(0);
  const [version, setVersion] = useState("");

  const [currentFile, setCurrentFile] = useState<CurrentFile | null>(null);

  const [theme, setTheme] = useTheme();

  const handleShare = useCallback(() => {
    if (workspace == null || files == null) {
      return;
    }

    const filesWithContent = Object.fromEntries(
      Object.entries(files).map(([name, handle]) => {
        return [name, workspace.sourceText(handle)];
      }),
    );

    persist(filesWithContent).catch((error) => {
      console.error("Failed to share playground", error);
    });
  }, [files, workspace]);

  if (initPromise.current == null) {
    initPromise.current = startPlayground()
      .then(({ version, files: workspaceFiles }) => {
        const settings = new Settings(TargetVersion.Py312);
        const workspace = new Workspace("/", settings);
        setVersion(version);
        setWorkspace(workspace);

        console.log(workspaceFiles);
        const files: Array<[string, FileHandle]> = Object.entries(
          workspaceFiles,
        ).map(([name, content]) => {
          const handle = workspace.openFile(name, content);
          return [name, handle];
        });

        setFiles(Object.fromEntries(files));

        if (files.length > 0) {
          const [currentName, handle] = files[0];
          setCurrentFile({
            handle,
            content: workspaceFiles[currentName],
          });
        }

        setRevision(1);
      })
      .catch((error) => {
        console.error("Failed to initialize playground.", error);
      });
  }

  const handleSourceChanged = useCallback(
    (source: string) => {
      if (
        workspace == null ||
        currentFile == null ||
        source == currentFile.content
      ) {
        return;
      }

      workspace.updateFile(currentFile.handle, source);

      setCurrentFile({
        ...currentFile,
        content: source,
      });
      setRevision((revision) => revision + 1);
    },
    [workspace, currentFile],
  );

  const handleFileClicked = useCallback(
    (file: FileHandle) => {
      if (workspace == null) {
        return;
      }

      setCurrentFile({
        handle: file,
        content: workspace.sourceText(file),
      });
    },
    [workspace],
  );

  const handleFileAdded = useCallback(
    (name: string) => {
      if (workspace == null) {
        return;
      }

      const handle = workspace.openFile(name, "");
      setCurrentFile({
        handle,
        content: "",
      });

      setFiles((files) => ({ ...files, [name]: handle }));
      setRevision((revision) => revision + 1);
    },
    [workspace],
  );

  const handleFileRemoved = useCallback(
    (file: FileHandle) => {
      if (workspace == null) {
        return;
      }

      const fileEntries = Object.entries(files);
      const index = fileEntries.findIndex(([, value]) => value === file);

      if (index === -1) {
        return;
      }

      // Remove the file
      fileEntries.splice(index, 1);

      if (currentFile?.handle === file) {
        const newCurrentFile =
          index > 0 ? fileEntries[index - 1] : fileEntries[index];

        if (newCurrentFile == null) {
          setCurrentFile(null);
        } else {
          const handle = newCurrentFile[1];
          setCurrentFile({
            handle,
            content: workspace.sourceText(handle),
          });
        }
      }

      workspace.closeFile(file);
      setFiles(Object.fromEntries(fileEntries));
      setRevision((revision) => revision + 1);
    },
    [currentFile, workspace, files],
  );

  const handleFileRenamed = useCallback(
    (file: FileHandle, newName: string) => {
      if (workspace == null) {
        return;
      }

      const content = workspace.sourceText(file);
      workspace.closeFile(file);
      const newFile = workspace.openFile(newName, content);

      if (currentFile?.handle === file) {
        setCurrentFile({
          content,
          handle: newFile,
        });
      }

      setFiles((files) => {
        const entries = Object.entries(files);
        const index = entries.findIndex(([, value]) => value === file);

        entries.splice(index, 1, [newName, newFile]);

        return Object.fromEntries(entries);
      });

      setRevision((revision) => (revision += 1));
    },
    [workspace, currentFile],
  );

  return (
    <main className="flex flex-col h-full bg-ayu-background dark:bg-ayu-background-dark">
      <Header
        edit={revision}
        theme={theme}
        version={version}
        onChangeTheme={setTheme}
        onShare={handleShare}
      />

      <div className="flex grow">
        <PanelGroup direction="horizontal" autoSaveId="main">
          {workspace != null && currentFile != null ? (
            <Panel
              id="main"
              order={0}
              className="flex flex-col gap-2"
              minSize={10}
            >
              <Files
                files={files}
                theme={theme}
                selected={currentFile?.handle ?? null}
                onAdd={handleFileAdded}
                onRename={handleFileRenamed}
                onSelected={handleFileClicked}
                onRemove={handleFileRemoved}
              />

              <div className="flex-grow">
                <Editor
                  theme={theme}
                  content={currentFile.content}
                  onSourceChanged={handleSourceChanged}
                  file={currentFile.handle}
                  workspace={workspace}
                />
              </div>
            </Panel>
          ) : null}
        </PanelGroup>
      </div>
    </main>
  );
}

// Run once during startup. Initializes monaco, loads the wasm file, and restores the previous editor state.
async function startPlayground(): Promise<{
  version: string;
  files: { [name: string]: string };
}> {
  await initRedKnot();
  const monaco = await loader.init();

  setupMonaco(monaco);

  const restored = await restore();

  const files = restored ?? {
    "main.py": "import os",
  };

  return {
    version: "0.0.0",
    files,
  };
}
