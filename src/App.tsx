import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "./App.css";
import logo from "./assets/LOGO 2.png";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

type Hydrant = {
  id: string;
  name: string | null;
  lat: number;
  lng: number;
  status: string | null;
  lastinspection: string | null;
  municipality: string | null;
  hassstorz: boolean | null;
  comments: string | null;
  created_at: string;
};

type NewHydrantForm = {
  name: string;
  lat: number;
  lng: number;
  status: string;
  municipality: string | null;
  hassstorz: boolean;
  lastinspection: string;
  comments: string;
};

type HydrantSubmissionForm = {
  name: string;
  lat: number;
  lng: number;
  municipality: string;
  status: string;
  hassstorz: boolean;
  lastinspection: string;
  comments: string;
  user_notes: string;
};

type HydrantSubmission = {
  id: string;
  type: "add" | "edit";
  hydrant_id: string | null;
  name: string | null;
  lat: number | null;
  lng: number | null;
  municipality: string | null;
  status: string | null;
  hassstorz: boolean | null;
  lastinspection: string | null;
  comments: string | null;
  user_notes: string | null;
  submission_status: "pending" | "approved" | "rejected";
  created_at: string;
};

const getStatusClass = (status: string | null) => {
  if (status === "ΛΕΙΤΟΥΡΓΙΚΟΣ") return "status-ok";
  if (status === "ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ") return "status-bad";
  if (status === "ΜΕ ΠΡΟΒΛΗΜΑ") return "status-warning";
  return "status-unknown";
};

const getMarkerIcon = (status: string | null) => {
  const color =
    status === "ΛΕΙΤΟΥΡΓΙΚΟΣ"
      ? "#21c45a"
      : status === "ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ"
      ? "#ef4444"
      : status === "ΜΕ ΠΡΟΒΛΗΜΑ"
      ? "#facc15"
      : "#64748b";

  return L.divIcon({
    className: "custom-hydrant-marker",
    html: `<div style="background:${color}" class="marker-dot"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -12],
  });
};

function MapFlyTo({ position }: { position: LatLngExpression | null }) {
  const map = useMap();

  useEffect(() => {
    if (position) {
      map.flyTo(position, 17, {
        duration: 0.8,
      });
    }
  }, [position, map]);

  return null;
}

function MapClickHandler({
  adminMode,
  onMapClick,
}: {
  adminMode: boolean;
  onMapClick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (!adminMode) return;

      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });

  return null;
}

const getSubmissionClientToken = () => {
  const storageKey = "hydrantsnearby_submission_token";

  const existingToken = localStorage.getItem(storageKey);

  if (existingToken) {
    return existingToken;
  }

  const newToken =
    crypto.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(storageKey, newToken);

  return newToken;
};

const isValidLatLng = (lat: number, lng: number) => {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
};

const normalizeMunicipality = (value: string | null | undefined) => {
  return (value ?? "")
    .replace(/^Δήμος\s+/i, "")
    .trim()
    .toLowerCase();
};

const getMunicipalityFromCoordinates = async (lat: number, lng: number) => {
  const url =
    `https://nominatim.openstreetmap.org/reverse` +
    `?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=el`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Απέτυχε ο έλεγχος δήμου από συντεταγμένες.");
  }

  const result = await response.json();
  const address = result.address ?? {};

  return (
    address.municipality ||
    address.city ||
    address.town ||
    address.village ||
    address.suburb ||
    address.city_district ||
    ""
  );
};

const getDistanceMeters = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
) => {
  const earthRadius = 6371000;

  const toRad = (value: number) => (value * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;

  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const findNearbyHydrant = (
  hydrants: Hydrant[],
  lat: number,
  lng: number,
  maxDistanceMeters = 8
) => {
  let nearest: { hydrant: Hydrant; distance: number } | null = null;

  for (const hydrant of hydrants) {
    const distance = getDistanceMeters(lat, lng, hydrant.lat, hydrant.lng);

    if (distance <= maxDistanceMeters) {
      if (!nearest || distance < nearest.distance) {
        nearest = { hydrant, distance };
      }
    }
  }

  return nearest;
};

function App() {
  const [hydrants, setHydrants] = useState<Hydrant[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState<LatLngExpression | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [storzFilter, setStorzFilter] = useState("ALL");
  const markerRefs = useRef<Record<string, L.Marker>>({});
  const [adminMode, setAdminMode] = useState(false);
  const [newHydrant, setNewHydrant] = useState<NewHydrantForm | null>(null);
  const [savingHydrant, setSavingHydrant] = useState(false);
  const [editingHydrantId, setEditingHydrantId] = useState<string | null>(null);
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
const [adminView, setAdminView] = useState<
  "operator" | "management" | "submissions" | "statistics"
>("operator");
  const [municipalityFilter, setMunicipalityFilter] = useState("ALL");
  const [customMunicipality, setCustomMunicipality] = useState(false);
  const [submissionType, setSubmissionType] = useState<"add" | "edit">("add");
  const [submissionHydrantId, setSubmissionHydrantId] = useState<string | null>(null);
  const [selectedSubmission, setSelectedSubmission] =
  useState<HydrantSubmission | null>(null);
  const [reviewingSubmission, setReviewingSubmission] = useState(false);

  const [addressSearch, setAddressSearch] = useState("");
  const [searchingAddress, setSearchingAddress] = useState(false);
  const [originalHydrant, setOriginalHydrant] = useState<Hydrant | null>(null);
  const [submissions, setSubmissions] = useState<HydrantSubmission[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);

  const [showSubmissionPanel, setShowSubmissionPanel] = useState(false);
  const [submissionForm, setSubmissionForm] = useState<HydrantSubmissionForm>({
    name: "",
    lat: 37.9838,
    lng: 23.7275,
    municipality: "",
    status: "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    hassstorz: false,
    lastinspection: new Date().toISOString().slice(0, 10),
    comments: "",
    user_notes: "",
  });
  const [savingSubmission, setSavingSubmission] = useState(false);

  useEffect(() => {
    const loadHydrants = async () => {
      const { data, error } = await supabase
        .from("hydrants")
        .select("*");

      if (error) {
        console.error(error);
   
        return;
      }

      setHydrants(data ?? []);
   
    };

    loadHydrants();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
  setSession(data.session);

  if (data.session) {
    checkAdminRole();
  }
});

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
  setSession(session);

  if (session) {
    checkAdminRole();
  } else {
    setIsAdmin(false);
    setAdminView("operator");
  }
});

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setAdminMode(adminView === "management");
  }, [adminView]);


  useEffect(() => {
    if (adminView === "submissions" && session) {
      loadPendingSubmissions();
    }
  }, [adminView, session]);


  const municipalities = useMemo(() => {
  return Array.from(
    new Set(
      hydrants
        .map((hydrant) => hydrant.municipality)
        .filter((municipality): municipality is string => Boolean(municipality))
    )
  ).sort((a, b) => a.localeCompare(b, "el"));
}, [hydrants]);

 const filteredHydrants = useMemo(() => {
  return hydrants.filter((hydrant) => {
    const matchesSearch =
      hydrant.name?.toLowerCase().includes(searchTerm.toLowerCase()) ?? false;

    const matchesStatus =
      statusFilter === "ALL" || hydrant.status === statusFilter;

    const matchesMunicipality =
  municipalityFilter === "ALL" ||
  hydrant.municipality === municipalityFilter;
   

    const matchesStorz =
      storzFilter === "ALL" ||
      String(hydrant.hassstorz) === storzFilter;

    return (
      matchesSearch &&
      matchesStatus &&
      matchesMunicipality &&
      matchesStorz
    );
  });
}, [hydrants, searchTerm, statusFilter,municipalityFilter,  storzFilter]);

const handleMapClickForNewHydrant = (lat: number, lng: number) => {
  setNewHydrant({
    name: "",
    lat,
    lng,
    status: "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    municipality: "",
    
    hassstorz: false,
    lastinspection: new Date().toISOString().slice(0, 10),
    comments: "",
  });
  setCustomMunicipality(false);
};

const saveHydrant = async () => {
  if (!newHydrant) return;

  if (!newHydrant.name.trim()) {
    alert("Συμπλήρωσε Διεύθυνση υδροστομίου.");
    return;
  }

  if (!(newHydrant.municipality ?? "").trim()) {
    alert("Συμπλήρωσε Δήμο.");
    return;
  }

  setSavingHydrant(true);

  let finalMunicipality = newHydrant.municipality ?? "";

  if (!isValidLatLng(newHydrant.lat, newHydrant.lng)) {
    alert("Οι συντεταγμένες δεν είναι έγκυρες.");
    return;
  }

  try {
    const detectedMunicipality = await getMunicipalityFromCoordinates(
      newHydrant.lat,
      newHydrant.lng
    );

    const selectedMunicipality = normalizeMunicipality(newHydrant.municipality);
    const detectedNormalized = normalizeMunicipality(detectedMunicipality);

    if (detectedNormalized && selectedMunicipality !== detectedNormalized) {
      const confirmed = window.confirm(
        `Ο δήμος που έχεις επιλέξει είναι "${newHydrant.municipality}", αλλά από τις συντεταγμένες προκύπτει "${detectedMunicipality}".\n\nΘέλεις να χρησιμοποιηθεί ο δήμος "${detectedMunicipality}";`
      );

      if (!confirmed) {
        setSavingHydrant(false);
        return;
      }

      finalMunicipality = detectedMunicipality.replace(/^Δήμος\s+/i, "").trim();
    }
  } catch (error) {
    console.error(error);

    const confirmed = window.confirm(
      "Δεν ήταν δυνατή η επιβεβαίωση του δήμου από τις συντεταγμένες. Θέλεις να συνεχίσεις;"
    );

    if (!confirmed) {
      setSavingHydrant(false);
      return;
    }
  }

  if (!editingHydrantId) {
  const nearbyHydrant = findNearbyHydrant(
    hydrants,
    newHydrant.lat,
    newHydrant.lng,
    8
  );

  if (nearbyHydrant) {
    const confirmed = window.confirm(
      `Υπάρχει ήδη κρουνός πολύ κοντά σε αυτό το σημείο:\n\n` +
       `${nearbyHydrant.hydrant.name ?? "Χωρίς όνομα"}\n` +
        `Δήμος: ${nearbyHydrant.hydrant.municipality ?? "-"}\n` +
          `Απόσταση: ${nearbyHydrant.distance.toFixed(1)} μέτρα\n\n` +
        `Θέλεις να συνεχίσεις την προσθήκη;`
    );

    if (!confirmed) {
      setSavingHydrant(false);
      return;
    }
  }
}

  const payload = {
    name: newHydrant.name,
    lat: newHydrant.lat,
    lng: newHydrant.lng,
    status: newHydrant.status,
    municipality: finalMunicipality || null,
    accessible: true,
    hassstorz: newHydrant.hassstorz,
    lastinspection: newHydrant.lastinspection || null,
    comments: newHydrant.comments || null,
  };

  if (editingHydrantId) {
    const { data, error } = await supabase
      .from("hydrants")
      .update(payload)
      .eq("id", editingHydrantId)
      .select()
      .single();

    if (error) {
      console.error(error);
      alert("Απέτυχε η ενημέρωση του υδροστομίου.");
      setSavingHydrant(false);
      return;
    }

    setHydrants((prev) =>
      prev.map((hydrant) =>
        hydrant.id === editingHydrantId ? data : hydrant
      )
    );

    setEditingHydrantId(null);
    setNewHydrant(null);
    setSavingHydrant(false);
    setCustomMunicipality(false);
    return;
  }

  const { data, error } = await supabase
    .from("hydrants")
    .insert(payload)
    .select()
    .single();

  if (error) {
    console.error(error);
    alert("Απέτυχε η αποθήκευση του υδροστομίου.");
    setSavingHydrant(false);
    return;
  }

  setHydrants((prev) => [data, ...prev]);
  setNewHydrant(null);
  setSavingHydrant(false);
};

const openEditHydrant = (hydrant: Hydrant) => {
  setEditingHydrantId(hydrant.id);

  setNewHydrant({
    name: hydrant.name ?? "",
    lat: hydrant.lat,
    lng: hydrant.lng,
    status: hydrant.status ?? "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    municipality: hydrant.municipality ?? "",
    hassstorz: hydrant.hassstorz ?? false,
    lastinspection: hydrant.lastinspection ?? "",
    comments: hydrant.comments ?? "",
  });
  
  setCustomMunicipality(false);
  setSelectedPosition([hydrant.lat, hydrant.lng]);
};

const deleteHydrant = async () => {
  if (!editingHydrantId) return;

  const confirmed = window.confirm(
    "Θέλεις σίγουρα να διαγράψεις αυτό το υδροστόμιο;"
  );

  if (!confirmed) return;

  setSavingHydrant(true);

  const { error } = await supabase
    .from("hydrants")
    .delete()
    .eq("id", editingHydrantId);

  if (error) {
    console.error(error);
    alert("Απέτυχε η διαγραφή του υδροστομίου.");
    setSavingHydrant(false);
    return;
  }

  setHydrants((prev) =>
    prev.filter((hydrant) => hydrant.id !== editingHydrantId)
  );

  setEditingHydrantId(null);
  setNewHydrant(null);
  setSavingHydrant(false);
};

const login = async () => {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    alert(error.message);
  }
};

const logout = async () => {
  setIsAdmin(false);
setAdminView("operator");
  await supabase.auth.signOut();
};

const exportHydrantsToCSV = () => {
  const headers = [
    "id",
    "name",
    "lat",
    "lng",
    "status",

    "hassstorz",
    "lastinspection",
    "comments",
    "created_at",
  ];

  const rows = hydrants.map((hydrant: any) =>
    headers.map((header) => {
      const value = hydrant[header] ?? "";
      return `"${String(value).replaceAll('"', '""')}"`;
    }).join(",")
  );

  const csvContent = [headers.join(","), ...rows].join("\n");

  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `hydrants-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();

  URL.revokeObjectURL(url);
};

const searchAddressForHydrant = async () => {
  if (!addressSearch.trim()) {
    alert("Συμπλήρωσε διεύθυνση.");
    return;
  }

  setSearchingAddress(true);

  try {
    const query = addressSearch.includes("Ελλάδα")
  ? addressSearch
  : `${addressSearch}, Ελλάδα`;

    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?format=jsonv2&q=${encodeURIComponent(query)}` +
      `&limit=1&addressdetails=1&accept-language=el`;

    const response = await fetch(url, {
      headers: {
        "Accept-Language": "el",
      },
    });

    if (!response.ok) {
      throw new Error("Απέτυχε η αναζήτηση διεύθυνσης.");
    }

    const results = await response.json();

    console.log("QUERY:", query);
    console.log("RESULTS:", results);

    if (!results.length) {
      alert("Δεν βρέθηκε η διεύθυνση.");
      return;
    }

    const result = results[0];

    const lat = Number(result.lat);
    const lng = Number(result.lon);

    setNewHydrant({
      name: addressSearch,
      lat,
      lng,
      status: "ΛΕΙΤΟΥΡΓΙΚΟΣ",
      municipality:
        result.address?.municipality ||
        result.address?.city ||
        result.address?.town ||
        result.address?.suburb ||
        "",
      hassstorz: false,
      lastinspection: new Date().toISOString().slice(0, 10),
      comments: "",
    });

    setEditingHydrantId(null);
    setCustomMunicipality(false);
    setSelectedPosition([lat, lng]);
  } catch (error) {
    console.error(error);
    alert("Προέκυψε σφάλμα κατά την αναζήτηση.");
  } finally {
    setSearchingAddress(false);
  }
};

const startAddHydrant = () => {
  setEditingHydrantId(null);

  setNewHydrant({
    name: "",
    lat: 37.9838,
    lng: 23.7275,
    status: "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    municipality: "",
    hassstorz: false,
    lastinspection: new Date().toISOString().slice(0, 10),
    comments: "",
  });

  setAddressSearch("");
  setCustomMunicipality(false);
};

const submitHydrantSuggestion = async () => {
  if (!submissionForm.name.trim()) {
    alert("Συμπλήρωσε διεύθυνση ή όνομα κρουνού.");
    return;
  }

  if (!submissionForm.municipality.trim()) {
    alert("Συμπλήρωσε Δήμο.");
    return;
  }

  setSavingSubmission(true); 

  let finalMunicipality = submissionForm.municipality;

if (!isValidLatLng(submissionForm.lat, submissionForm.lng)) {
  alert("Οι συντεταγμένες δεν είναι έγκυρες.");
  return;
}

try {
  const detectedMunicipality = await getMunicipalityFromCoordinates(
    submissionForm.lat,
    submissionForm.lng
  );

  const selectedMunicipality = normalizeMunicipality(submissionForm.municipality);
  const detectedNormalized = normalizeMunicipality(detectedMunicipality);

  if (detectedNormalized && selectedMunicipality !== detectedNormalized) {
    const confirmed = window.confirm(
      `Ο δήμος που δήλωσες είναι "${submissionForm.municipality}", αλλά από τις συντεταγμένες προκύπτει "${detectedMunicipality}".\n\nΘέλεις να χρησιμοποιηθεί ο δήμος "${detectedMunicipality}";`
    );

    if (!confirmed) {
      setSavingSubmission(false);
      return;
    }

    finalMunicipality = detectedMunicipality.replace(/^Δήμος\s+/i, "").trim();
  }
} catch (error) {
  console.error(error);

  const confirmed = window.confirm(
    "Δεν ήταν δυνατή η επιβεβαίωση του δήμου από τις συντεταγμένες. Θέλεις να συνεχίσεις;"
  );

  if (!confirmed) {
    setSavingSubmission(false);
    return;
  }
}

  const { error } = await supabase.from("hydrant_submissions").insert({
   type: submissionType,
    hydrant_id: submissionHydrantId,
    name: submissionForm.name,
    lat: submissionForm.lat,
    lng: submissionForm.lng,
    municipality: finalMunicipality,
    status: submissionForm.status,
    hassstorz: submissionForm.hassstorz,
    lastinspection: submissionForm.lastinspection || null,
    comments: submissionForm.comments || null,
    user_notes: submissionForm.user_notes || null,
    submission_status: "pending",
    client_token: getSubmissionClientToken(),
  });

  setSavingSubmission(false);

  if (error) {
      console.error(error);

      if (
        error.message.includes("row-level security") ||
        error.message.includes("violates row-level security")
      ) {
        alert("Έχεις φτάσει το όριο των 5 υποβολών ανά ώρα.");
      } else {
        alert("Απέτυχε η υποβολή.");
      }

      return;
    }

  alert("Η υποβολή στάλθηκε για έλεγχο.");

  setShowSubmissionPanel(false);
  setSubmissionForm({
    name: "",
    lat: 37.9838,
    lng: 23.7275,
    municipality: "",
    status: "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    hassstorz: false,
    lastinspection: new Date().toISOString().slice(0, 10),
    comments: "",
    user_notes: "",
  });
};

const loadPendingSubmissions = async () => {
  setLoadingSubmissions(true);

  const { data, error } = await supabase
    .from("hydrant_submissions")
    .select("*")
    .eq("submission_status", "pending")
    .order("created_at", { ascending: false });

  setLoadingSubmissions(false);

  if (error) {
    console.error(error);
    alert("Απέτυχε η φόρτωση των υποβολών.");
    return;
  }

  setSubmissions(data ?? []);
};

const approveSubmission = async (submission: HydrantSubmission) => {
  if (reviewingSubmission) return;

  const confirmed = window.confirm("Θέλεις να εγκρίνεις αυτή την υποβολή;");
  if (!confirmed) return;

  setReviewingSubmission(true);

  if (
  submission.type === "add" &&
  submission.lat !== null &&
  submission.lng !== null
) {
  const nearbyHydrant = findNearbyHydrant(
    hydrants,
    submission.lat,
    submission.lng,
    8
  );

  if (nearbyHydrant) {
    const confirmed = window.confirm(
      `Υπάρχει ήδη κρουνός πολύ κοντά σε αυτό το σημείο:\n\n` +
        `${nearbyHydrant.hydrant.name ?? "Χωρίς όνομα"}\n` +
        `Δήμος: ${nearbyHydrant.hydrant.municipality ?? "-"}\n` +
          `Απόσταση: ${nearbyHydrant.distance.toFixed(1)} μέτρα\n\n` +
        `Θέλεις να εγκρίνεις την υποβολή παρόλα αυτά;`
    );

    if (!confirmed) {
      setReviewingSubmission(false);
      return;
    }
  }
}

  const { error: insertError } = await supabase.from("hydrants").insert({
    name: submission.name,
    lat: submission.lat,
    lng: submission.lng,
    municipality: submission.municipality,
    status: submission.status,
    accessible: true,
    hassstorz: submission.hassstorz,
    lastinspection: submission.lastinspection,
    comments: submission.comments,
  });

  if (insertError) {
    console.error(insertError);
    alert("Απέτυχε η δημιουργία κρουνού από την υποβολή.");
    setReviewingSubmission(false);
    return;
  }

  const { error: updateError } = await supabase
    .from("hydrant_submissions")
    .update({
      submission_status: "approved",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", submission.id);

  if (updateError) {
    console.error(updateError);
    alert("Ο κρουνός δημιουργήθηκε, αλλά απέτυχε η ενημέρωση της υποβολής.");
    setReviewingSubmission(false);
    return;
  }

  setSubmissions((prev) => prev.filter((item) => item.id !== submission.id));
  setSelectedSubmission(null);
  setReviewingSubmission(false);

  alert("Η υποβολή εγκρίθηκε.");
};

const rejectSubmission = async (submission: HydrantSubmission) => {
  if (reviewingSubmission) return;

  const confirmed = window.confirm("Θέλεις να απορρίψεις αυτή την υποβολή;");
  if (!confirmed) return;

  setReviewingSubmission(true);

  const { error } = await supabase
    .from("hydrant_submissions")
    .update({
      submission_status: "rejected",
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", submission.id);

  if (error) {
    console.error(error);
    alert("Απέτυχε η απόρριψη της υποβολής.");
    setReviewingSubmission(false);
    return;
  }

  setSubmissions((prev) => prev.filter((item) => item.id !== submission.id));
  setSelectedSubmission(null);
  setReviewingSubmission(false);

  alert("Η υποβολή απορρίφθηκε.");
};

const openEditSuggestion = (hydrant: Hydrant) => {
  setSubmissionForm({
    name: hydrant.name ?? "",
    lat: hydrant.lat,
    lng: hydrant.lng,
    municipality: hydrant.municipality ?? "",
    status: hydrant.status ?? "ΛΕΙΤΟΥΡΓΙΚΟΣ",
    hassstorz: hydrant.hassstorz ?? false,
    lastinspection: hydrant.lastinspection ?? new Date().toISOString().slice(0, 10),
    comments: hydrant.comments ?? "",
    user_notes: "",
  });

  setSubmissionType("edit");
  setSubmissionHydrantId(hydrant.id);
  setShowSubmissionPanel(true);
};

const checkAdminRole = async () => {
  const { data: sessionData } = await supabase.auth.getSession();

  const userId = sessionData.session?.user.id;

  if (!userId) {
    setIsAdmin(false);
    return;
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .single();

  if (error || !data) {
    setIsAdmin(false);
    setAdminView("operator");
    return;
  }

    setIsAdmin(true);
    setAdminView("management");
};

const municipalityStats = useMemo(() => {
  const counts = new Map<string, number>();

  hydrants.forEach((hydrant) => {
    const municipality = hydrant.municipality || "Άγνωστο";
    counts.set(municipality, (counts.get(municipality) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([municipality, count]) => ({
      municipality,
      count,
    }))
    .sort((a, b) => b.count - a.count);
}, [hydrants]);

const statusStats = useMemo(() => {
  const counts = new Map<string, number>();

  hydrants.forEach((hydrant) => {
    const status = hydrant.status || "Άγνωστο";
    counts.set(status, (counts.get(status) ?? 0) + 1);
  });

  return Array.from(counts.entries()).map(([name, value]) => ({
    name,
    value,
  }));
}, [hydrants]);

const storzStats = useMemo(() => {
  const withStorz = hydrants.filter((hydrant) => hydrant.hassstorz).length;
  const withoutStorz = hydrants.length - withStorz;

  return [
    { name: "Με Storz", value: withStorz },
    { name: "Χωρίς Storz", value: withoutStorz },
  ];
}, [hydrants]);

const totalHydrants = hydrants.length;
const workingHydrants = hydrants.filter(
  (hydrant) => hydrant.status === "ΛΕΙΤΟΥΡΓΙΚΟΣ"
).length;
const problemHydrants = hydrants.filter(
  (hydrant) => hydrant.status === "ΜΕ ΠΡΟΒΛΗΜΑ"
).length;
const outOfServiceHydrants = hydrants.filter(
  (hydrant) => hydrant.status === "ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ"
).length;

return (
  <div className="app-shell">
    <header className="top-navbar">
      <div className="brand">
        <div className="brand-icon">
          <img
            src={logo}
            alt="Brand Logo"
            style={{ width: "60px", height: "auto" }}
          />
        </div>
        <div>
          <div className="brand-title">HydrantsNearby</div>
          <div className="brand-subtitle">Εντοπίστε πυροσβεστικούς κρουνούς Κοντά σας σε δευτερόλεπτα</div>
        </div>
      </div>

     

      <div className="top-actions">
       {!session ? (
          <>
            <input
              className="login-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <input
              className="login-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <button className="login-btn" onClick={login}>
              Login
            </button>
          </>
        ) : (
          <>
           {isAdmin && (
          <select
            className="admin-mode-select"
            value={adminView}
            onChange={(e) =>
              setAdminView(
                e.target.value as "operator" | "management" | "submissions" | "statistics"
              )
            }
          >
           <option value="operator">Χειριστής</option>
          <option value="management">Διαχείριστης</option>
          
          </select>
        )}

        {isAdmin && (
          <button className="export-btn" onClick={exportHydrantsToCSV}>
            Export CSV
          </button>
        )}

            <button className="logout-btn" onClick={logout}>
              Logout
            </button>
          </>
        )}

        {!session && (
          <button
            type="button"
            className="submit-suggestion-btn"
            onClick={() => {
              setSubmissionType("add");
              setSubmissionHydrantId(null);
              setShowSubmissionPanel(true);
            }}
          >
            Υποβολή Κρουνού
          </button>
        )}
        
      </div>
    </header>

    <main className="dashboard-layout">
      <aside className={`left-panel ${newHydrant ? "panel-disabled" : ""}`}>
        

        <div className="filter-box">
          <div className="filter-row">
    <input
      type="text"
      placeholder="Αναζήτηση υδροστομίου..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />

        <select
      value={municipalityFilter}
      onChange={(e) => setMunicipalityFilter(e.target.value)}
    >
      <option value="ALL">Όλοι οι Δήμοι</option>

      {municipalities.map((municipality) => (
        <option key={municipality} value={municipality}>
          {municipality}
        </option>
      ))}
    </select>


    <select
      value={statusFilter}
      onChange={(e) => setStatusFilter(e.target.value)}
    >
      <option value="ALL">Όλες οι καταστάσεις</option>
      <option value="ΛΕΙΤΟΥΡΓΙΚΟΣ">Λειτουργικός</option>
      <option value="ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ">Εκτός λειτουργίας</option>
    </select>

    

    <select
      value={storzFilter}
      onChange={(e) => setStorzFilter(e.target.value)}
    >
      <option value="ALL">Storz: Όλα</option>
      <option value="true">Storz: Ναι</option>
      <option value="false">Storz: Όχι</option>
    </select>

    {newHydrant && (
  <div className="admin-panel">
    <div className="admin-panel-header">
      <strong>
        {editingHydrantId ? "Επεξεργασία Υδροστομίου" : "Νέο Υδροστόμιο"}
      </strong>
      <button
        onClick={() => {
          setNewHydrant(null);
          setEditingHydrantId(null);
        }}
      >
        ×
      </button>
    </div>

    <div className="admin-panel-body">
      {!editingHydrantId && (
        <div className="address-search-box">
          <label>
            Αναζήτηση με διεύθυνση
            <input
              type="text"
              value={addressSearch}
              onChange={(e) => setAddressSearch(e.target.value)}
              placeholder="π.χ. Μεσογείων 100, Αθήνα"
            />
          </label>

          <button
            type="button"
            className="address-search-btn"
            onClick={searchAddressForHydrant}
            disabled={searchingAddress}
          >
            {searchingAddress ? "Αναζήτηση..." : "Εύρεση στο χάρτη"}
          </button>
        </div>
      )}
      
      <label>
        Διεύθυνση
        <input
          type="text"
          value={newHydrant.name}
          onChange={(e) =>
            setNewHydrant({ ...newHydrant, name: e.target.value })
          }
        />
      </label>
      
      <label>
  Δήμος
  <select
    value={customMunicipality ? "__CUSTOM__" : newHydrant.municipality ?? ""}
    onChange={(e) => {
      if (e.target.value === "__CUSTOM__") {
        setCustomMunicipality(true);
        setNewHydrant({
          ...newHydrant,
          municipality: "",
        });
        return;
      }

      setCustomMunicipality(false);
      setNewHydrant({
        ...newHydrant,
        municipality: e.target.value,
      });
    }}
  >
    <option value="">Επιλογή Δήμου</option>

    {municipalities.map((municipality) => (
      <option key={municipality} value={municipality}>
        {municipality}
      </option>
    ))}

    <option value="__CUSTOM__">Άλλος Δήμος...</option>
  </select>
</label>

      {customMunicipality && (
        <label>
          Νέος Δήμος
          <input
            type="text"
            value={newHydrant.municipality ?? ""}
            onChange={(e) =>
              setNewHydrant({
                ...newHydrant,
                municipality: e.target.value,
              })
            }
            placeholder="Πληκτρολόγησε δήμο"
          />
        </label>
      )}

      <div className="admin-grid">
        <label>
          Latitude
          <input type="number" value={newHydrant.lat} disabled />
        </label>

        <label>
          Longitude
          <input type="number" value={newHydrant.lng} disabled />
        </label>
      </div>

      <label>
        Κατάσταση
        <select
          value={newHydrant.status}
          onChange={(e) =>
            setNewHydrant({ ...newHydrant, status: e.target.value })
          }
        >
          <option value="ΛΕΙΤΟΥΡΓΙΚΟΣ">Λειτουργικός</option>
          <option value="ΜΕ ΠΡΟΒΛΗΜΑ">Με πρόβλημα</option>
          <option value="ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ">Εκτός λειτουργίας</option>
        </select>
      </label>

      <label>
        Τελευταίος έλεγχος
        <input
          type="date"
          value={newHydrant.lastinspection}
          onChange={(e) =>
            setNewHydrant({ ...newHydrant, lastinspection: e.target.value })
          }
        />
      </label>

      

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={newHydrant.hassstorz}
          onChange={(e) =>
            setNewHydrant({ ...newHydrant, hassstorz: e.target.checked })
          }
        />
        Διαθέτει Storz
      </label>

      <label>
        Σχόλια
        <textarea
          value={newHydrant.comments}
          onChange={(e) =>
            setNewHydrant({ ...newHydrant, comments: e.target.value })
          }
        />
      </label>

      <button
        className="save-hydrant-btn"
        onClick={saveHydrant}
        disabled={savingHydrant}
      >
        {savingHydrant
          ? "Αποθήκευση..."
          : editingHydrantId
          ? "Ενημέρωση Υδροστομίου"
          : "Αποθήκευση Υδροστομίου"}

      </button>

      {editingHydrantId && (
        <button
          className="delete-hydrant-btn"
          onClick={deleteHydrant}
          disabled={savingHydrant}
        >
          Διαγραφή Υδροστομίου
        </button>
      )}
    </div>


  </div>

  
)}

    {showSubmissionPanel && (
  <div className="admin-panel">
    <div className="admin-panel-header">
     <strong>
        {submissionType === "add"
          ? "Υποβολή Νέου Κρουνού"
          : "Πρόταση Τροποποίησης Κρουνού"}
      </strong>
      <button onClick={() => setShowSubmissionPanel(false)}>×</button>
    </div>

    <div className="admin-panel-body">
      <label>
        Διεύθυνση / Όνομα
        <input
          value={submissionForm.name}
          onChange={(e) =>
            setSubmissionForm({ ...submissionForm, name: e.target.value })
          }
        />
      </label>

      <label>
        Δήμος
        <input
          value={submissionForm.municipality}
          onChange={(e) =>
            setSubmissionForm({
              ...submissionForm,
              municipality: e.target.value,
            })
          }
        />
      </label>

      <div className="admin-grid">
        <label>
          Latitude
          <input
            type="number"
            value={submissionForm.lat}
            onChange={(e) =>
              setSubmissionForm({
                ...submissionForm,
                lat: Number(e.target.value),
              })
            }
          />
        </label>

        <label>
          Longitude
          <input
            type="number"
            value={submissionForm.lng}
            onChange={(e) =>
              setSubmissionForm({
                ...submissionForm,
                lng: Number(e.target.value),
              })
            }
          />
        </label>
      </div>

      <label>
        Κατάσταση
        <select
          value={submissionForm.status}
          onChange={(e) =>
            setSubmissionForm({ ...submissionForm, status: e.target.value })
          }
        >
          <option value="ΛΕΙΤΟΥΡΓΙΚΟΣ">Λειτουργικός</option>
          <option value="ΜΕ ΠΡΟΒΛΗΜΑ">Με πρόβλημα</option>
          <option value="ΕΚΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ">Εκτός λειτουργίας</option>
        </select>
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={submissionForm.hassstorz}
          onChange={(e) =>
            setSubmissionForm({
              ...submissionForm,
              hassstorz: e.target.checked,
            })
          }
        />
        Διαθέτει Storz
      </label>

      <label>
        Σχόλια
        <textarea
          value={submissionForm.comments}
          onChange={(e) =>
            setSubmissionForm({
              ...submissionForm,
              comments: e.target.value,
            })
          }
        />
      </label>

      <label>
        Παρατηρήσεις υποβολής
        <textarea
          value={submissionForm.user_notes}
          onChange={(e) =>
            setSubmissionForm({
              ...submissionForm,
              user_notes: e.target.value,
            })
          }
        />
      </label>

      <button
        className="save-hydrant-btn"
        onClick={submitHydrantSuggestion}
        disabled={savingSubmission}
      >
        {savingSubmission ? "Υποβολή..." : "Υποβολή για Έλεγχο"}
      </button>
    </div>
  </div>
)}
  </div>

<div className="filter-summary">
  Εμφανίζονται {filteredHydrants.length} από {hydrants.length} υδροστόμια
</div>
        </div>
{adminView === "statistics" ? (
  <div className="statistics-dashboard">
    <div className="stats-cards">
      <div className="stats-card">
        <span>Σύνολο Κρουνών</span>
        <strong>{totalHydrants}</strong>
      </div>

      <div className="stats-card">
        <span>Λειτουργικοί</span>
        <strong>{workingHydrants}</strong>
      </div>

      <div className="stats-card">
        <span>Με Πρόβλημα</span>
        <strong>{problemHydrants}</strong>
      </div>

      <div className="stats-card">
        <span>Εκτός Λειτουργίας</span>
        <strong>{outOfServiceHydrants}</strong>
      </div>
    </div>

    <div className="chart-box">
      <h3>Κρουνοί ανά Δήμο</h3>
      <ResponsiveContainer width="100%" height={420}>
        <BarChart data={municipalityStats}>
          <XAxis
            dataKey="municipality"
            angle={-45}
            textAnchor="end"
            height={90}
            interval={0}
            tick={{ fontSize: 11 }}
          />
          <YAxis />
          <Tooltip />
          <Bar dataKey="count" fill="#1591e8" />
        </BarChart>
      </ResponsiveContainer>
    </div>

    <div className="chart-grid">
      <div className="chart-box">
        <h3>Κατάσταση Κρουνών</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={statusStats}
              dataKey="value"
              nameKey="name"
              outerRadius={80}
              label
            >
              {statusStats.map((_, index) => (
                <Cell
                  key={index}
                  fill={["#22c55e", "#facc15", "#ef4444", "#94a3b8"][index % 4]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-box">
        <h3>Σύνδεση Storz</h3>
        <ResponsiveContainer width="100%" height={250}>
          <PieChart>
            <Pie
              data={storzStats}
              dataKey="value"
              nameKey="name"
              outerRadius={80}
              label
            >
              {storzStats.map((_, index) => (
                <Cell
                  key={index}
                  fill={["#1591e8", "#64748b"][index % 2]}
                />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  </div>
) : adminView === "submissions" ? (
  <div className="hydrants-table">
    <div className="table-header submissions-header">
        <span>ΗΜ/ΝΙΑ</span>
        <span>ΤΥΠΟΣ</span>
        <span>ΟΝΟΜΑ</span>
        <span>ΔΗΜΟΣ</span>
        <span>STATUS</span>
        <span>ΕΝΕΡΓΕΙΕΣ</span>
      </div>

    {loadingSubmissions ? (
  <div
  className="table-row submissions-row">
        <span>Φόρτωση υποβολών...</span>
      </div>
    ) : submissions.length === 0 ? (
      <div
  className="table-row submissions-row">
        <span>Δεν υπάρχουν pending υποβολές.</span>
      </div>
    ) : (
      submissions.map((submission) => (
        <div
            className="table-row"
            key={submission.id}
            onClick={async () => {
            setSelectedSubmission(submission);

            if (submission.type === "edit" && submission.hydrant_id) {
              const { data, error } = await supabase
                .from("hydrants")
                .select("*")
                .eq("id", submission.hydrant_id)
                .single();

              if (error) {
                console.error(error);
                alert("Απέτυχε η φόρτωση του αρχικού κρουνού.");
                return;
              }

              setOriginalHydrant(data);
            } else {
              setOriginalHydrant(null);
            }
          }}
          >
          <span>
            {new Date(submission.created_at).toLocaleDateString("el-GR")}
          </span>
          <span>{submission.type === "add" ? "Προσθήκη" : "Τροποποίηση"}</span>
          <span>{submission.name ?? "-"}</span>
          <span>{submission.municipality ?? "-"}</span>
          <span>{submission.status ?? "-"}</span>
          <span className="submission-actions">
            <button
              type="button"
              className="quick-approve-btn"
              disabled={reviewingSubmission}
              onClick={(e) => {
                e.stopPropagation();
                approveSubmission(submission);
              }}
            >
              ✓
            </button>

            <button
              type="button"
              className="quick-reject-btn"
              disabled={reviewingSubmission}
              onClick={(e) => {
                e.stopPropagation();
                rejectSubmission(submission);
              }}
            >
              ×
            </button>
          </span>
        </div>
      ))
    )}
  </div>
) : (
        <div className="hydrants-table">
          <div className="table-header">
            <span>ΔΙΕΥΘΥΝΣΗ</span>
            <span>ΔΗΜΟΣ</span>
            <span>ΚΑΤΑΣΤΑΣΗ</span>
            
            <span>STORZ</span>
            <span>ΤΕΛ. ΕΛΕΓΧΟΣ</span>
          </div>

          {filteredHydrants.map((hydrant) => (
            <div
              className="table-row"
              key={hydrant.id}
              onClick={() => {
                setSelectedPosition([hydrant.lat, hydrant.lng]);

                setTimeout(() => {
                  markerRefs.current[hydrant.id]?.openPopup();
                }, 850);
              }}

              onDoubleClick={() => {
                if (adminMode) {
                  openEditHydrant(hydrant);
                }
              }}
            >
              <span>{hydrant.name ?? "-"}</span>
              <span>{hydrant.municipality ?? "-"}</span>
             <span className={getStatusClass(hydrant.status)}>
                {hydrant.status ?? "-"}
              </span>
              
              <span>{hydrant.hassstorz ? "Ναι" : "Όχι"}</span>
              <span>{hydrant.lastinspection ?? "-"}</span>
            </div>
          ))}
        </div>
        )}
      </aside>
      {selectedSubmission && (
  <div className="admin-panel">
    <div className="admin-panel-header">
      <strong>Έλεγχος Υποβολής</strong>
      <button onClick={() => setSelectedSubmission(null)}>×</button>
    </div>

    <div className="admin-panel-body">
      

      {selectedSubmission.type === "edit" && originalHydrant && (
  <div className="comparison-box">
    <h4>Σύγκριση αλλαγών</h4>

    {[
      ["Όνομα", originalHydrant.name, selectedSubmission.name],
      ["Δήμος", originalHydrant.municipality, selectedSubmission.municipality],
      ["Κατάσταση", originalHydrant.status, selectedSubmission.status],
      ["Storz", originalHydrant.hassstorz ? "Ναι" : "Όχι", selectedSubmission.hassstorz ? "Ναι" : "Όχι"],
      ["Τελ. Έλεγχος", originalHydrant.lastinspection, selectedSubmission.lastinspection],
      ["Σχόλια", originalHydrant.comments, selectedSubmission.comments],
    ].map(([label, oldValue, newValue]) => {
      const changed = String(oldValue ?? "-") !== String(newValue ?? "-");

      return (
        <div
          key={label}
          className={`change-card ${changed ? "changed" : "unchanged"}`}
        >
          <div className="change-label">{label}</div>

          <div className="change-values">
            <div>
              <span className="value-title">Τρέχον</span>
              <span className="old-value">{oldValue ?? "-"}</span>
            </div>

            <div className="arrow">→</div>

            <div>
              <span className="value-title">Προτεινόμενο</span>
              <span className="new-value">{newValue ?? "-"}</span>
            </div>
          </div>
        </div>
      );
    })}
  </div>
)}

      <button
        className="save-hydrant-btn"
        disabled={reviewingSubmission}
        onClick={() => approveSubmission(selectedSubmission)}
      >
        Έγκριση
      </button>

      <button
        className="delete-hydrant-btn"
        disabled={reviewingSubmission}
        onClick={() => rejectSubmission(selectedSubmission)}
      >
        Απόρριψη
      </button>
    </div>
  </div>
)}

      <section className="map-panel">
        <div className="map-header">
          <button
            type="button"
            className="map-tab map-tab-button"
            onClick={() => {
              setAdminView("management");
              setNewHydrant(null);
              setSelectedSubmission(null);
            }}
          >
            Χάρτης
          </button>

          {isAdmin && (
  <>
    <button
      type="button"
      className="new-hydrant-map-btn"
      onClick={() => {
        setAdminView("management");
        startAddHydrant();
      }}
    >
      Νέος Κρουνός
    </button>

    <button
      type="button"
      className="submissions-map-btn"
      onClick={() => setAdminView("submissions")}
    >
      Υποβολές
      {submissions.length > 0 && (
        <span className="submissions-badge">{submissions.length}</span>
      )}
    </button>

    <button
      type="button"
      className="statistics-map-btn"
      onClick={() => setAdminView("statistics")}
    >
      Στατιστικά
    </button>
  </>
)}
        </div>
        <MapContainer
          center={[37.9838, 23.7275]}
          zoom={12}
          className="map-container"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {newHydrant && (
            <Marker position={[newHydrant.lat, newHydrant.lng]}>
              <Popup>
                Νέο υδροστόμιο προς καταχώρηση
              </Popup>
            </Marker>
          )}

          <MapClickHandler
            adminMode={adminMode}
            onMapClick={handleMapClickForNewHydrant}
          />
          <MapFlyTo position={selectedPosition} />
          
          <MarkerClusterGroup chunkedLoading>
              {filteredHydrants.map((hydrant) => (
                <Marker
                  key={hydrant.id}
                  position={[hydrant.lat, hydrant.lng]}
                  icon={getMarkerIcon(hydrant.status)}
                  ref={(marker) => {
                    if (marker) {
                      markerRefs.current[hydrant.id] = marker;
                    }
                  }}
                >
                  <Popup>
                    <strong>{hydrant.name ?? "Unnamed hydrant"}</strong>
                    <br />
                    Δήμος: {hydrant.municipality ?? "N/A"}
                    <br />
                    Status: {hydrant.status ?? "N/A"}
                
                    <br />
                    Has Storz: {hydrant.hassstorz ? "Yes" : "No"}
                    <br />
                    Last inspection: {hydrant.lastinspection ?? "N/A"}
                    <br />
                    Comments: {hydrant.comments ?? "No comments"}

                    {!session && (
                    <>
                      <br />
                      <button
                        type="button"
                        className="suggest-edit-btn"
                        onClick={() => openEditSuggestion(hydrant)}
                      >
                        Πρόταση τροποποίησης
                      </button>
                    </>
                  )}
                  </Popup>
                </Marker>
              ))}
            </MarkerClusterGroup>
        </MapContainer>
      </section>

    </main>

<footer className="footer">

  <div className="footer-left">
    HydrantsNearby © 2026
  </div>

  <div className="footer-center">
    <a href="/help.html#usage">Όροι Χρήσης</a>

    <span style={{ margin: "0 8px" }}>|</span>

    <a href="/help.html#privacy">Πολιτική Απορρήτου</a>

    <span style={{ margin: "0 8px" }}>|</span>

    <a href="/help.html#help">Βοήθεια</a>
  </div>

  <div className="footer-right">
    Version 2.0.1
  </div>

</footer>

</div>
);
}

export default App;
