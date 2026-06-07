import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./lib/supabase";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";

import L from "leaflet";
import "./App.css";
import logo from "./assets/LOGO 2.png";

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

function App() {
  const [hydrants, setHydrants] = useState<Hydrant[]>([]);

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
  const [adminView, setAdminView] = useState<"operator" | "management">("operator");
  const [municipalityFilter, setMunicipalityFilter] = useState("ALL");
  const [customMunicipality, setCustomMunicipality] = useState(false);

  const [addressSearch, setAddressSearch] = useState("");
  const [searchingAddress, setSearchingAddress] = useState(false);

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
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setAdminMode(adminView === "management");
  }, [adminView]);

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

  const payload = {
    name: newHydrant.name,
    lat: newHydrant.lat,
    lng: newHydrant.lng,
    status: newHydrant.status,
    municipality: newHydrant.municipality || null,
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
           {session && (
          <select
            className="admin-mode-select"
            value={adminView}
            onChange={(e) =>
              setAdminView(e.target.value as "operator" | "management")
            }
          >
            <option value="operator">Χειριστής</option>
            <option value="management">Διαχείριση</option>
          </select>
        )}

        {session && (
          <button className="export-btn" onClick={exportHydrantsToCSV}>
            Export CSV
          </button>
        )}

            <button className="logout-btn" onClick={logout}>
              Logout
            </button>
          </>
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
  </div>

<div className="filter-summary">
  Εμφανίζονται {filteredHydrants.length} από {hydrants.length} υδροστόμια
</div>
        </div>

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
      </aside>

      <section className="map-panel">
        <div className="map-header">
          <div className="map-tab">
            Χάρτης
          </div>

          {adminMode && (
            <button
              className="new-hydrant-map-btn"
              onClick={startAddHydrant}
            >
              Νέος Κρουνός
            </button>
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
    Version 2.0.0
  </div>

</footer>

</div>
);
}

export default App;
