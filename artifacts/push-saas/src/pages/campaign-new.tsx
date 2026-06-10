import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useCreateCampaign } from "@/hooks/use-push-api";
import { Navbar } from "@/components/layout/navbar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronDown, BellRing, Loader2, Upload, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { apiFetch } from "@/lib/api";

const campaignSchema = z.object({
  title: z.string().min(1, "Title is required"),
  message: z.string().min(1, "Message is required"),
  destinationUrl: z.string().min(1, "Destination URL is required").url("Must be a valid URL"),
  iconUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  imageUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  label: z.string().optional(),
  sendMode: z.enum(["now", "schedule"]),
  scheduledAt: z.string().optional(),
  targetingFilters: z.object({
    country: z.string().optional(),
    browser: z.string().optional(),
    os: z.string().optional(),
    deviceType: z.string().optional(),
    language: z.string().optional(),
    has_tag: z.string().optional(),
    not_tag: z.string().optional(),
  }).optional()
});

export default function CampaignNewPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createCampaign = useCreateCampaign();
  
  const [isTargetingOpen, setIsTargetingOpen] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const iconFileRef = useRef<HTMLInputElement>(null);

  const handleIconUpload = async (file: File) => {
    setIconUploading(true);
    try {
      const formData = new FormData();
      formData.append("icon", file);
      const res = await fetch("/pn/sdk/upload-icon", { method: "POST", body: formData });
      const data = await res.json();
      if (data.url) {
        form.setValue("iconUrl", data.url, { shouldValidate: true });
      } else {
        toast({ title: "Upload failed", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    } finally {
      setIconUploading(false);
    }
  };

  const form = useForm<z.infer<typeof campaignSchema>>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      title: "",
      message: "",
      destinationUrl: "https://",
      iconUrl: "",
      imageUrl: "",
      label: "",
      sendMode: "now",
      scheduledAt: "",
      targetingFilters: {
        country: "",
        browser: "",
        os: "",
        deviceType: "",
        language: "",
        has_tag: "",
        not_tag: ""
      }
    },
  });

  const watchTitle = form.watch("title");
  const watchMessage = form.watch("message");
  const watchIcon = form.watch("iconUrl");
  const watchImage = form.watch("imageUrl");
  const watchSendMode = form.watch("sendMode");

  const onSubmit = (data: z.infer<typeof campaignSchema>) => {
    if (!siteId) return;

    // Clean up empty targeting filters
    const filters = { ...data.targetingFilters };
    Object.keys(filters).forEach(key => {
      const k = key as keyof typeof filters;
      if (!filters[k] || filters[k] === "") delete filters[k];
    });

    const payload = {
      title: data.title,
      message: data.message,
      destinationUrl: data.destinationUrl,
      iconUrl: data.iconUrl || null,
      imageUrl: data.imageUrl || null,
      label: data.label || null,
      scheduledAt: data.sendMode === "schedule" && data.scheduledAt ? new Date(data.scheduledAt).toISOString() : null,
      sendNow: data.sendMode === "now",
      targetingFilters: Object.keys(filters).length > 0 ? filters : null
    };

    createCampaign.mutate({ siteId, data: payload }, {
      onSuccess: () => {
        toast({ title: "Campaign created!" });
        navigate(`/sites/${siteId}`);
      },
      onError: (err: any) => {
        toast({ title: "Error creating campaign", description: err.message, variant: "destructive" });
      }
    });
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <Navbar />
      
      <main className="max-w-5xl mx-auto px-4 py-8">
        <Button variant="ghost" className="mb-6 -ml-4" onClick={() => navigate(`/sites/${siteId}`)}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          Back to Site
        </Button>
        
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Create Campaign</h1>
          <p className="text-muted-foreground mt-1">Design and send a new push notification</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Content</CardTitle>
                    <CardDescription>What should the notification say?</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField control={form.control} name="title" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Title</FormLabel>
                        <FormControl><Input placeholder="Huge Sale!" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="message" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Message</FormLabel>
                        <FormControl><Textarea placeholder="Get 50% off all items today only." rows={3} {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="destinationUrl" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Destination URL</FormLabel>
                        <FormControl><Input placeholder="https://example.com/sale" {...field} /></FormControl>
                        <FormDescription>Where users go when they click</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <FormField control={form.control} name="iconUrl" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Notification Icon (Optional)</FormLabel>
                          <div className="flex items-start gap-3">
                            {field.value ? (
                              <div className="relative flex-shrink-0">
                                <img src={field.value} alt="Icon" className="w-14 h-14 rounded-lg object-cover border border-border bg-muted" onError={(e) => (e.currentTarget.style.display = 'none')} />
                                <button type="button" onClick={() => field.onChange("")} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-4 h-4 flex items-center justify-center">
                                  <X className="w-2.5 h-2.5" />
                                </button>
                              </div>
                            ) : null}
                            <div className="flex-1 space-y-2">
                              <input
                                ref={iconFileRef}
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleIconUpload(file);
                                  e.target.value = "";
                                }}
                              />
                              <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => iconFileRef.current?.click()} disabled={iconUploading}>
                                {iconUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                                {iconUploading ? "Uploading…" : "Upload Image"}
                              </Button>
                              <FormControl>
                                <Input placeholder="or paste URL…" {...field} className="text-xs" />
                              </FormControl>
                            </div>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )} />
                      <FormField control={form.control} name="imageUrl" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Large Image URL (Optional)</FormLabel>
                          <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Delivery</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField control={form.control} name="sendMode" render={({ field }) => (
                      <FormItem className="space-y-3">
                        <FormControl>
                          <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl><RadioGroupItem value="now" /></FormControl>
                              <FormLabel className="font-normal">Send Now</FormLabel>
                            </FormItem>
                            <FormItem className="flex items-center space-x-3 space-y-0">
                              <FormControl><RadioGroupItem value="schedule" /></FormControl>
                              <FormLabel className="font-normal">Schedule for Later</FormLabel>
                            </FormItem>
                          </RadioGroup>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />

                    {watchSendMode === "schedule" && (
                      <FormField control={form.control} name="scheduledAt" render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date & Time</FormLabel>
                          <FormControl><Input type="datetime-local" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )} />
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <Collapsible open={isTargetingOpen} onOpenChange={setIsTargetingOpen}>
                    <CardHeader className="pb-4">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between cursor-pointer group">
                          <div>
                            <CardTitle>Audience Targeting</CardTitle>
                            <CardDescription>Send to specific segments (leave blank for all)</CardDescription>
                          </div>
                          <Button variant="ghost" size="icon" type="button" className="group-hover:bg-accent">
                            <ChevronDown className={`w-5 h-5 transition-transform ${isTargetingOpen ? "rotate-180" : ""}`} />
                          </Button>
                        </div>
                      </CollapsibleTrigger>
                    </CardHeader>
                    <CollapsibleContent>
                      <CardContent className="space-y-4 pt-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <FormField control={form.control} name="targetingFilters.country" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Countries (comma-separated)</FormLabel>
                              <FormControl><Input placeholder="US, GB, CA" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="targetingFilters.browser" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Browsers (comma-separated)</FormLabel>
                              <FormControl><Input placeholder="Chrome, Safari" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="targetingFilters.os" render={({ field }) => (
                            <FormItem>
                              <FormLabel>OS (comma-separated)</FormLabel>
                              <FormControl><Input placeholder="Windows, Mac OS" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="targetingFilters.deviceType" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Device Type</FormLabel>
                              <FormControl><Input placeholder="desktop, mobile" {...field} /></FormControl>
                            </FormItem>
                          )} />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t">
                          <FormField control={form.control} name="targetingFilters.has_tag" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Must Have Tag</FormLabel>
                              <FormControl><Input placeholder="e.g. premium" {...field} /></FormControl>
                            </FormItem>
                          )} />
                          <FormField control={form.control} name="targetingFilters.not_tag" render={({ field }) => (
                            <FormItem>
                              <FormLabel>Must NOT Have Tag</FormLabel>
                              <FormControl><Input placeholder="e.g. unsubscribed" {...field} /></FormControl>
                            </FormItem>
                          )} />
                        </div>
                      </CardContent>
                    </CollapsibleContent>
                  </Collapsible>
                </Card>

                <div className="flex justify-end gap-4">
                  <Button type="button" variant="outline" onClick={() => navigate(`/sites/${siteId}`)}>Cancel</Button>
                  <Button type="submit" disabled={createCampaign.isPending}>
                    {createCampaign.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Create Campaign
                  </Button>
                </div>
              </form>
            </Form>
          </div>

          <div>
            <div className="sticky top-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Preview</h3>
              
              <div className="bg-card border border-border shadow-xl rounded-xl overflow-hidden max-w-sm">
                <div className="p-4 flex gap-4">
                  <div className="flex-shrink-0">
                    {watchIcon ? (
                      <img src={watchIcon} alt="Icon" className="w-12 h-12 rounded-lg object-cover bg-muted" onError={(e) => (e.currentTarget.style.display = 'none')} />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                        <BellRing className="w-6 h-6" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-foreground truncate">{watchTitle || "Notification Title"}</h4>
                    <p className="text-sm text-muted-foreground line-clamp-2 mt-1 leading-snug">
                      {watchMessage || "Your message will appear here."}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-2 opacity-60">Push Notify • now</p>
                  </div>
                </div>
                {watchImage && (
                  <div className="w-full h-32 bg-muted border-t border-border">
                    <img src={watchImage} alt="Large" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
