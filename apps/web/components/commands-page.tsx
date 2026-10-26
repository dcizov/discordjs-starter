"use client";
import {
  commandModuleLabels,
  type CommandCatalog,
} from "@orbit/core/command-catalog-types";
import { BookOpen, ShieldCheck, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CopyButton } from "./copy-button";
import { PageHeader } from "./page-header";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  SearchInput,
  FormSelect,
  Skeleton,
} from "./ui/primitives";
import { useWorkspace } from "./workspace";

function permissionName(name: string) {
  return name === "ManageGuild"
    ? "Manage Server"
    : name.replace(/([a-z])([A-Z])/g, "$1 $2");
}
export function CommandsPage() {
  const { api, data } = useWorkspace();
  const [catalog, setCatalog] = useState<CommandCatalog | null>(null);
  const [query, setQuery] = useState("");
  const [module, setModule] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const moduleState = JSON.stringify(data.guild.config.modules);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api("/commands")
      .then((result) => {
        if (active) setCatalog(result);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, data.guild.id, moduleState, retry]);
  const needle = query.trim().toLowerCase();
  const commands = (catalog?.commands ?? []).filter(
    (c) =>
      (module === "all" || c.module === module) &&
      [
        c.path,
        c.description,
        c.usage,
        commandModuleLabels[c.module],
        ...c.defaultPermissions.names.map(permissionName),
        ...c.runtimePermissions.map(permissionName),
        ...c.notes,
        ...c.arguments.flatMap((a) => [
          a.name,
          a.description,
          ...a.choices.map((choice) => `${choice.name} ${choice.value}`),
        ]),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle)
  );
  return (
    <>
      <PageHeader
        title="One command away."
        description="A searchable reference to the slash commands implemented by this version of Orbit."
        badge="Command reference"
      />
      <Card className="mb-5 flex items-start gap-3 bg-muted/20 p-4">
        <BookOpen size={18} className="mt-0.5 shrink-0 text-violet-400" />
        <div className="text-[11px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground">
            Same definitions. No guesswork.
          </p>
          <p className="mt-1">
            Generated from the registration definitions — it does not check what
            Discord currently has. After changing definitions, run{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              npm run commands:register
            </code>
            ; this page never registers or runs anything.
          </p>
          <p className="mt-1">
            Channel types, suggested placement, caller/bot permissions and what
            happens when setup is incomplete are in{" "}
            <Link
              href="/docs/where-to-use"
              className="text-primary underline-offset-2 hover:underline"
            >
              Where to use each module
            </Link>
            . Requirements there are enforced; recommendations are not.
          </p>
        </div>
      </Card>
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Search commands, arguments, or permissions…"
        />
        <FormSelect
          aria-label="Filter command module"
          value={module}
          onValueChange={setModule}
          className="h-9 sm:w-44"
          options={[
            { value: "all", label: "All modules" },
            ...Object.entries(commandModuleLabels).map(([key, label]) => ({
              value: key,
              label,
            })),
          ]}
        />
      </div>
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <Card>
          <ErrorState
            title="The command reference couldn’t load."
            detail={error}
            onRetry={() => setRetry((r) => r + 1)}
          />
        </Card>
      ) : (
        <>
          <p
            className="mb-4 text-[11px] text-muted-foreground"
            aria-live="polite"
          >
            Showing {commands.length} of {catalog?.invocationCount} command
            invocations · {catalog?.rootCount} top-level commands.
            &lt;argument&gt; is required; [argument] is optional.
          </p>
          {!commands.length ? (
            <Card>
              <EmptyState
                title="No commands match"
                description="Try another search or choose a different module."
              />
            </Card>
          ) : (
            <div
              className="grid items-start gap-4 xl:grid-cols-2"
              aria-label="Command reference"
            >
              {commands.map((command) => (
                <Card
                  key={command.id}
                  role="article"
                  aria-label={`/${command.path}`}
                  className="min-w-0 overflow-hidden"
                >
                  <div className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <h2 className="flex items-center gap-2 font-mono text-sm font-semibold">
                        <Terminal size={15} className="text-violet-400" />/
                        {command.path}
                      </h2>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="purple">
                          {commandModuleLabels[command.module]}
                        </Badge>
                        {command.module !== "general" && (
                          <Badge
                            tone={command.moduleEnabled ? "green" : "amber"}
                          >
                            {command.moduleEnabled
                              ? "Module on"
                              : "Module paused"}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                      {command.description}
                    </p>
                    <div className="mt-4 rounded-lg border bg-muted/30 px-3 py-2.5">
                      <code className="block whitespace-pre-wrap break-words text-[11px]">
                        {command.usage}
                      </code>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <ShieldCheck size={12} />
                        {command.defaultPermissions.bitfield === "0"
                          ? "Administrators by default"
                          : command.defaultPermissions.names.length
                            ? command.defaultPermissions.names
                                .map(permissionName)
                                .join(", ")
                            : "Everyone by default"}
                      </span>
                      <CopyButton
                        text={command.usage}
                        label={`Copy /${command.path} usage`}
                        success="Command usage copied"
                      />
                    </div>
                  </div>
                  <details className="border-t">
                    <summary className="cursor-pointer px-5 py-3 text-[11px] font-medium text-muted-foreground hover:bg-muted/20">
                      Arguments & execution checks
                    </summary>
                    <div className="space-y-4 px-5 pb-5 text-[11px] leading-relaxed">
                      {command.arguments.length ? (
                        <dl className="space-y-3">
                          {command.arguments.map((argument) => (
                            <div key={argument.name}>
                              <dt className="font-medium">
                                <code>{argument.name}</code>{" "}
                                <span className="font-normal text-muted-foreground">
                                  · {argument.type} ·{" "}
                                  {argument.required ? "Required" : "Optional"}
                                  {argument.autocomplete
                                    ? " · Autocomplete"
                                    : ""}
                                </span>
                              </dt>
                              <dd className="mt-1 text-muted-foreground">
                                {argument.description}
                                {(argument.minLength !== null ||
                                  argument.maxLength !== null) && (
                                  <p>
                                    Length: {argument.minLength ?? "no minimum"}
                                    –{argument.maxLength ?? "no maximum"}{" "}
                                    characters
                                  </p>
                                )}
                                {(argument.minValue !== null ||
                                  argument.maxValue !== null) && (
                                  <p>
                                    Range: {argument.minValue ?? "no minimum"}–
                                    {argument.maxValue ?? "no maximum"}
                                  </p>
                                )}
                                {!!argument.choices.length && (
                                  <p>
                                    Choices:{" "}
                                    {argument.choices
                                      .map(
                                        (choice) =>
                                          `${choice.name} (${choice.value})`
                                      )
                                      .join(", ")}
                                  </p>
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      ) : (
                        <p className="text-muted-foreground">No arguments.</p>
                      )}
                      <div className="space-y-2 rounded-lg bg-muted/30 p-3 text-muted-foreground">
                        <p>
                          {command.serverOnly
                            ? "Server-only command; unavailable in direct messages."
                            : "Availability follows the registration definition."}
                        </p>
                        {!!command.runtimePermissions.length && (
                          <p className="font-medium text-foreground">
                            Additional runtime permission:{" "}
                            {command.runtimePermissions
                              .map(permissionName)
                              .join(", ")}
                            .
                          </p>
                        )}
                        {command.notes.map((note) => (
                          <p key={note}>{note}</p>
                        ))}
                        <p>
                          Default visibility is not an authorization guarantee.
                          Discord overrides and live actor/bot permissions are
                          checked when applicable.
                        </p>
                      </div>
                    </div>
                  </details>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
