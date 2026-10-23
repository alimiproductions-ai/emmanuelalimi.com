-- Boutique Emmanuel Alimi : base de données (Supabase / Postgres)
-- À coller une seule fois dans Supabase › SQL Editor › New query › Run.
-- L'administrateur est le compte dont l'e-mail est défini dans la fonction est_admin().

-- ---------- administrateur ----------
create or replace function public.est_admin() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'alimiproductions@gmail.com'
$$;

-- ---------- réglages (une seule ligne) ----------
create table if not exists public.reglages (
  id int primary key default 1 check (id = 1),
  cout_impression numeric not null default 6,
  cout_cadre numeric not null default 49,
  cout_emballage_encadre numeric not null default 10,
  cout_emballage_print numeric not null default 4,
  cout_livraison numeric not null default 45,
  frais_pct numeric not null default 4.01,      -- frais PayPal en %, TVA incluse
  frais_fixe numeric not null default 1.42,     -- frais PayPal fixes en ₪, TVA incluse
  format_encadre text not null default 'A3 sous passe-partout, cadre noir 40×50 cm',
  format_print text not null default 'Impression A3 (29,7×42 cm), sans cadre',
  delai text not null default '5 à 7 jours',
  zones jsonb not null default '[{"code":"IL","nom":"Israël","encadre":0,"print":0},{"code":"FR","nom":"France","encadre":150,"print":50},{"code":"NA","nom":"États-Unis et Canada","encadre":200,"print":70},{"code":"WW","nom":"Reste du monde","encadre":220,"print":80}]'::jsonb, -- supplément livraison par zone
  updated_at timestamptz not null default now()
);
insert into public.reglages (id) values (1) on conflict do nothing;

-- ---------- produits ----------
create table if not exists public.produits (
  id uuid primary key default gen_random_uuid(),
  titre text not null,
  annee text default '',
  texte text default '',
  image_url text default '',
  prix_encadre numeric default 0,   -- 0 = option non proposée
  prix_print numeric default 0,
  statut text not null default 'disponible' check (statut in ('disponible','epuise','masque')),
  original boolean not null default false,
  edition int not null default 0,   -- 0 = non limitée
  vendus int not null default 0,
  ordre int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- commandes ----------
create sequence if not exists public.numero_commande start 1001;
create table if not exists public.commandes (
  id uuid primary key default gen_random_uuid(),
  numero int not null default nextval('public.numero_commande') unique,
  token text not null default replace(gen_random_uuid()::text, '-', '') unique, -- lien de suivi du client
  created_at timestamptz not null default now(),
  statut text not null default 'en_attente' check (statut in ('en_attente','payee','en_preparation','expediee','livree','annulee')),
  produit_id uuid references public.produits(id) on delete set null,
  produit_titre text not null,
  option text not null check (option in ('encadre','print')),
  option_detail text default '',
  prix numeric not null,
  client_nom text not null,
  client_email text not null,
  client_tel text default '',
  adresse text not null,
  ville text not null,
  code_postal text default '',
  pays text not null default 'Israël',
  zone text not null default 'IL',
  frais_livraison numeric not null default 0,  -- part de livraison incluse dans prix
  note_client text default '',
  note_interne text default '',
  source text not null default 'site' check (source in ('site','manuel')),
  paypal_order_id text unique,
  paypal_capture_id text,
  paye_le timestamptz,
  transporteur text default '',
  suivi_numero text default '',
  suivi_url text default '',
  cout_impression numeric default 0,
  cout_cadre numeric default 0,
  cout_emballage numeric default 0,
  cout_livraison numeric default 0,
  frais_paiement numeric default 0,
  stock_deduit boolean not null default false
);
create index if not exists commandes_statut on public.commandes(statut);
create index if not exists commandes_created on public.commandes(created_at desc);

create table if not exists public.historique (
  id bigserial primary key,
  commande_id uuid not null references public.commandes(id) on delete cascade,
  statut text not null,
  message text default '',
  email_envoye boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- stock ----------
create table if not exists public.stock (
  id uuid primary key default gen_random_uuid(),
  article text not null,
  quantite int not null default 0,
  seuil int not null default 2,
  cout_unitaire numeric default 0,
  conso_encadre int not null default 0,  -- utilisé par commande « encadré »
  conso_print int not null default 0,    -- utilisé par commande « print seul »
  ordre int not null default 0
);

-- ---------- sécurité (RLS) ----------
alter table public.reglages enable row level security;
alter table public.produits enable row level security;
alter table public.commandes enable row level security;
alter table public.historique enable row level security;
alter table public.stock enable row level security;

drop policy if exists "produits lisibles" on public.produits;
create policy "produits lisibles" on public.produits for select using (statut <> 'masque' or public.est_admin());
drop policy if exists "produits admin" on public.produits;
create policy "produits admin" on public.produits for all using (public.est_admin()) with check (public.est_admin());

drop policy if exists "reglages lisibles" on public.reglages;
create policy "reglages lisibles" on public.reglages for select using (true);
drop policy if exists "reglages admin" on public.reglages;
create policy "reglages admin" on public.reglages for all using (public.est_admin()) with check (public.est_admin());

drop policy if exists "commandes admin" on public.commandes;
create policy "commandes admin" on public.commandes for all using (public.est_admin()) with check (public.est_admin());
drop policy if exists "historique admin" on public.historique;
create policy "historique admin" on public.historique for all using (public.est_admin()) with check (public.est_admin());
drop policy if exists "stock admin" on public.stock;
create policy "stock admin" on public.stock for all using (public.est_admin()) with check (public.est_admin());

-- ---------- photos des produits ----------
insert into storage.buckets (id, name, public) values ('produits', 'produits', true) on conflict do nothing;
drop policy if exists "photos lisibles" on storage.objects;
create policy "photos lisibles" on storage.objects for select using (bucket_id = 'produits');
drop policy if exists "photos admin" on storage.objects;
create policy "photos admin" on storage.objects for all using (bucket_id = 'produits' and public.est_admin()) with check (bucket_id = 'produits' and public.est_admin());

-- ---------- données de départ ----------
insert into public.produits (titre, annee, texte, image_url, prix_encadre, prix_print, statut, original, ordre)
select * from (values
  ('Tenoftevet // Hafatza', '2025', '10 Tevet, un jeûne pour la délivrance.', 'https://www.emmanuelalimi.com/img/boutique/tenoftevet-hafatza-1600.webp', 260, 120, 'disponible', false, 1),
  ('Delusional Joy', '2026', 'Soukkot 2026, un hommage au Rav Israël.', 'https://www.emmanuelalimi.com/img/boutique/delusional-joy-1600.webp', 260, 120, 'disponible', true, 2),
  ('Sefirot 354', '2025', 'L''arbre des Sefirot.', 'https://www.emmanuelalimi.com/img/boutique/sefirot-354-1600.webp', 260, 120, 'disponible', false, 3)
) v(titre, annee, texte, image_url, prix_encadre, prix_print, statut, original, ordre)
where not exists (select 1 from public.produits);

insert into public.stock (article, quantite, seuil, cout_unitaire, conso_encadre, conso_print, ordre)
select * from (values
  ('Cadre KNOPPÄNG noir 40×50 (IKEA)', 0, 2, 49, 1, 0, 1),
  ('Impression A3', 0, 3, 6, 1, 1, 2),
  ('Carton d''expédition pour cadre', 0, 2, 10, 1, 0, 3),
  ('Tube ou enveloppe rigide A3', 0, 2, 4, 0, 1, 4)
) v(article, quantite, seuil, cout_unitaire, conso_encadre, conso_print, ordre)
where not exists (select 1 from public.stock);

-- ---------- temps réel (nouvelles commandes visibles tout de suite dans la gestion) ----------
do $$ begin
  alter publication supabase_realtime add table public.commandes;
exception when others then null;
end $$;
