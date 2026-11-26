import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { kongInvitationReceiptSchema, kongInvitationStatus, type KongInvitationLedger } from "@shared/kong-invitation-agent";

const endpoint = "/api/agents-office/kong-invitations";
export function KongInvitationsPanel() {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const client = useQueryClient();
  const query = useQuery<{ receipt: KongInvitationLedger | null }>({ queryKey: [endpoint], enabled: open, retry: false });
  const status = kongInvitationStatus(query.data?.receipt, Date.now());
  const receipt = query.data?.receipt?.receipt;
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const parsed = kongInvitationReceiptSchema.parse(JSON.parse(raw));
      const response = await apiRequest("POST", endpoint, parsed);
      const saved = await response.json() as { receipt?: KongInvitationLedger };
      const reread = await fetch(endpoint, { credentials: "include", cache: "no-store" });
      if (!reread.ok) throw Error("readback");
      const checked = await reread.json() as { receipt?: KongInvitationLedger };
      if (!saved.receipt?.sha256 || checked.receipt?.sha256 !== saved.receipt.sha256) throw Error("readback");
      client.setQueryData([endpoint], checked);
      await client.invalidateQueries({ queryKey: ["/api/agent-council/state"] });
      setMessage("Recibo guardado y releído. No se inició ningún envío.");
      setRaw("");
    } catch { setMessage("No se confirmó el registro. Relee el estado antes de repetir; no se inició ningún envío."); }
    finally { setSaving(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button className="absolute bottom-14 left-3 z-[110] border border-lime-200/30 bg-slate-950 text-white" data-testid="open-kong-invitations">Invitaciones a DJs</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto border-lime-200/20 bg-slate-950 text-white">
      <DialogTitle>Invitaciones a DJs · KONG</DialogTitle>
      <DialogDescription>Coordinador local externo, con la misma carrera y vida de la empresa. Apps Script conserva el único envío autorizado. Esta oficina recibe resultados; no ejecuta ni duplica el correo.</DialogDescription>
      <p role="status">{query.isError ? "No se pudo leer el registro." : status.label}</p>
      <p className="text-sm">{status.detail}</p>
      <p className="text-xs text-slate-300">{receipt ? `Último resultado: ${receipt.completedAt}. Procedencia: ${receipt.provenance}. Próxima secuencia: ${receipt.sequence + 1}.` : "Aún no hay recibos. Primera secuencia: 1."}</p>
      <p className="text-xs text-slate-300">Una revisión o admisión no prueba un envío. Solo se cuentan envíos con recibos Gmail distintos del reloj original. Los chequeos sin trabajo nuevo no dan puntos.</p>
      <label htmlFor="kong-invitation-receipt">Recibo de resultados del coordinador</label>
      <textarea id="kong-invitation-receipt" className="min-h-40 rounded border border-white/20 bg-black p-2 text-xs" value={raw} onChange={e => setRaw(e.target.value)} placeholder="JSON de metadatos, sin correos ni nombres de artistas" />
      <Button onClick={save} disabled={saving || !raw.trim() || query.isError} data-testid="save-kong-invitation-receipt">{saving ? "Guardando…" : "Guardar y verificar recibo"}</Button>
      {message && <p role="status">{message}</p>}
    </DialogContent>
  </Dialog>;
}
