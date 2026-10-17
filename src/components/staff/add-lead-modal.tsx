"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect, Textarea } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Sheet } from "@/components/ui/dialog";
import { useApp } from "@/components/app-shell";

/** "Add Lead" modal — creates a real record in the database. */
export function AddLeadModal({ onCreated }: { onCreated: () => void }) {
  const { niches } = useApp();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    businessName: "",
    contactName: "",
    phone: "",
    email: "",
    city: "",
    address: "",
    websiteUrl: "",
    gmapLink: "",
    opensAt: "",
    websiteStatus: "Active",
    serviceStatus: "Unclaimed",
    rating: "",
    reviewsCount: "",
    competitorName: "",
    competitorReviews: "",
    nicheId: 0,
    // extended lead structure
    title: "",
    mobileNo: "",
    nicheCategory: "",
    statusService: "",
    leadStatus: "",
    leadCloseAmount: "",
    reviews: "",
  });

  async function create() {
    setBusy(true);
    const res = await fetch("/api/leads/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, nicheId: form.nicheId || undefined }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Lead created");
      setOpen(false);
      setForm({ ...form, businessName: "", contactName: "", phone: "", email: "", city: "" });
      onCreated();
    } else toast.error(json.error ?? "Could not create lead");
    setBusy(false);
  }

  const valid = form.businessName.trim().length >= 2 && form.phone.replace(/\D/g, "").length >= 10;

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add Lead
      </Button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Add Lead"
        description="Creates a real record. New leads start in the Pool with status “New”."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || !valid} onClick={() => void create()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Create lead
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label>Business name *</Label>
              <Input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} placeholder="Sharma Properties" />
            </div>
            <div className="space-y-1">
              <Label>Phone *</Label>
              <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9810012345" />
            </div>
            <div className="space-y-1">
              <Label>Contact person</Label>
              <Input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Priya Sharma" />
            </div>
            <div className="space-y-1">
              <Label>City keyword</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="andheri-west" />
            </div>
            <div className="space-y-1">
              <Label>Niche</Label>
              <NativeSelect value={form.nicheId} onChange={(e) => setForm({ ...form, nicheId: Number(e.target.value) })}>
                <option value={0}>My default niche</option>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Rating</Label>
              <NumberInput value={form.rating} onValueChange={(v) => setForm({ ...form, rating: v })} placeholder="4.2" />
            </div>
            <div className="space-y-1">
              <Label>Reviews count</Label>
              <NumberInput value={form.reviewsCount} onValueChange={(v) => setForm({ ...form, reviewsCount: v })} allowDecimal={false} placeholder="48" />
            </div>
            <div className="space-y-1">
              <Label>Competitor name</Label>
              <Input value={form.competitorName} onChange={(e) => setForm({ ...form, competitorName: e.target.value })} placeholder="NextDoor" />
            </div>
            <div className="space-y-1">
              <Label>Competitor reviews</Label>
              <NumberInput value={form.competitorReviews} onValueChange={(v) => setForm({ ...form, competitorReviews: v })} allowDecimal={false} placeholder="120" />
            </div>
            <div className="space-y-1">
              <Label>Website</Label>
              <Input value={form.websiteUrl} onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://example.in" />
            </div>
            <div className="space-y-1">
              <Label>Opens at</Label>
              <Input value={form.opensAt} onChange={(e) => setForm({ ...form, opensAt: e.target.value })} placeholder="09:30 AM - 07:00 PM" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Google Maps link</Label>
              <Input value={form.gmapLink} onChange={(e) => setForm({ ...form, gmapLink: e.target.value })} placeholder="https://maps.google.com/?cid=…" />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Premium listing enquiry" />
            </div>
            <div className="space-y-1">
              <Label>Alternate mobile no.</Label>
              <Input inputMode="tel" value={form.mobileNo} onChange={(e) => setForm({ ...form, mobileNo: e.target.value })} placeholder="9876500001" />
            </div>
            <div className="space-y-1">
              <Label>Niche category</Label>
              <Input value={form.nicheCategory} onChange={(e) => setForm({ ...form, nicheCategory: e.target.value })} placeholder="Real Estate / Clinics…" />
            </div>
            <div className="space-y-1">
              <Label>Service status</Label>
              <Input value={form.statusService} onChange={(e) => setForm({ ...form, statusService: e.target.value })} placeholder="Website unclaimed" />
            </div>
            <div className="space-y-1">
              <Label>Lead status</Label>
              <NativeSelect value={form.leadStatus} onChange={(e) => setForm({ ...form, leadStatus: e.target.value })}>
                <option value="">— not set —</option>
                <option value="HOT">Hot</option>
                <option value="WARM">Warm</option>
                <option value="COLD">Cold</option>
                <option value="DO_NOT_CALL">Do Not Call</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Close amount (₹)</Label>
              <NumberInput value={form.leadCloseAmount} onValueChange={(v) => setForm({ ...form, leadCloseAmount: v })} placeholder="25000" />
            </div>
            <div className="space-y-1">
              <Label>Reviews</Label>
              <NumberInput value={form.reviews} onValueChange={(v) => setForm({ ...form, reviews: v })} allowDecimal={false} placeholder="48" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Address</Label>
              <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="min-h-[64px]" />
            </div>
          </div>
        </div>
      </Sheet>
    </>
  );
}
