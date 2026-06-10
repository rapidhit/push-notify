import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

// Types
export interface Site {
  id: string;
  userId: string;
  siteId: string;
  name: string;
  domain: string;
  vapidPublicKey: string;
  promptConfig: any;
  subscriberCount: number;
  createdAt: string;
}

export interface Subscriber {
  id: number;
  siteId: string;
  endpoint: string;
  country: string | null;
  city: string | null;
  region: string | null;
  browser: string | null;
  os: string | null;
  deviceType: string | null;
  language: string | null;
  screenWidth: number | null;
  screenHeight: number | null;
  active: boolean;
  tags: string[];
  subscribedAt: string;
}

export interface Campaign {
  id: number;
  siteId: string;
  title: string;
  message: string;
  iconUrl: string | null;
  imageUrl: string | null;
  destinationUrl: string;
  label: string | null;
  status: 'draft' | 'scheduled' | 'sending' | 'sent';
  targetingFilters: any;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  stats: { sent: number; delivered: number; clicked: number } | null;
}

export interface Segment {
  tag: string;
  count: number;
}

// Sites
export function useSites() {
  return useQuery<Site[]>({
    queryKey: ["sites"],
    queryFn: () => apiFetch("/sites"),
  });
}

export function useSite(siteId: string) {
  return useQuery<Site>({
    queryKey: ["sites", siteId],
    queryFn: () => apiFetch(`/sites/${siteId}`),
    enabled: !!siteId,
  });
}

export function useCreateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; domain: string; promptConfig?: Record<string, unknown> }) => apiFetch("/sites", {
      method: "POST",
      body: JSON.stringify(data),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

export function useUpdateSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: Partial<Site> }) => apiFetch(`/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
    onSuccess: (updatedSite) => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
      queryClient.invalidateQueries({ queryKey: ["sites", updatedSite.siteId] });
    },
  });
}

export function useDeleteSite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (siteId: string) => apiFetch(`/sites/${siteId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sites"] });
    },
  });
}

// Subscribers
export function useSubscribers(siteId: string) {
  return useQuery<Subscriber[]>({
    queryKey: ["sites", siteId, "subscribers"],
    queryFn: () => apiFetch(`/sites/${siteId}/subscribers`),
    enabled: !!siteId,
  });
}

export function useDeleteSubscriber() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, subscriberId }: { siteId: string; subscriberId: number }) => 
      apiFetch(`/sites/${siteId}/subscribers/${subscriberId}`, { method: "DELETE" }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "subscribers"] });
    },
  });
}

export function useAddSubscriberTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, subscriberId, tag }: { siteId: string; subscriberId: number; tag: string }) => 
      apiFetch(`/sites/${siteId}/subscribers/${subscriberId}/tags`, {
        method: "POST",
        body: JSON.stringify({ tag }),
      }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "subscribers"] });
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "segments"] });
    },
  });
}

export function useRemoveSubscriberTag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, subscriberId, tag }: { siteId: string; subscriberId: number; tag: string }) => 
      apiFetch(`/sites/${siteId}/subscribers/${subscriberId}/tags/${tag}`, { method: "DELETE" }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "subscribers"] });
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "segments"] });
    },
  });
}

export function useSegments(siteId: string) {
  return useQuery<Segment[]>({
    queryKey: ["sites", siteId, "segments"],
    queryFn: () => apiFetch(`/sites/${siteId}/segments`),
    enabled: !!siteId,
  });
}

// Campaigns
export function useCampaigns(siteId: string) {
  return useQuery<Campaign[]>({
    queryKey: ["sites", siteId, "campaigns"],
    queryFn: () => apiFetch(`/sites/${siteId}/campaigns`),
    enabled: !!siteId,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, data }: { siteId: string; data: any }) => 
      apiFetch(`/sites/${siteId}/campaigns`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "campaigns"] });
    },
  });
}

export function useSendCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, campaignId }: { siteId: string; campaignId: number }) => 
      apiFetch(`/sites/${siteId}/campaigns/${campaignId}/send`, { method: "POST" }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "campaigns"] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, campaignId }: { siteId: string; campaignId: number }) => 
      apiFetch(`/sites/${siteId}/campaigns/${campaignId}`, { method: "DELETE" }),
    onSuccess: (_, { siteId }) => {
      queryClient.invalidateQueries({ queryKey: ["sites", siteId, "campaigns"] });
    },
  });
}

// Admin (needs custom fetch passing admin password)
export function adminFetch(path: string, password: string, options: RequestInit = {}) {
  return fetch(`/pn${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": password,
      ...options.headers,
    },
  }).then(async (res) => {
    if (!res.ok) {
      let msg = "Admin error";
      try {
        const data = await res.json();
        msg = data.message || msg;
      } catch (e) {}
      throw new Error(msg);
    }
    return res.json();
  });
}
