-- Livraison par zone + 5 nouveaux prints. À coller une fois dans Supabase › SQL Editor › Run.

-- Zones : supplément payé par le client en plus du prix du print (Israël = inclus).
alter table public.reglages add column if not exists zones jsonb not null default '[
  {"code":"IL","nom":"Israël","encadre":0,"print":0},
  {"code":"FR","nom":"France","encadre":150,"print":50},
  {"code":"NA","nom":"États-Unis et Canada","encadre":200,"print":70},
  {"code":"WW","nom":"Reste du monde","encadre":220,"print":80}
]'::jsonb;

-- Commandes : zone, pays et part de livraison incluse dans « prix » (prix = total payé).
alter table public.commandes add column if not exists zone text not null default 'IL';
alter table public.commandes add column if not exists pays text not null default 'Israël';
alter table public.commandes add column if not exists frais_livraison numeric not null default 0;

-- Nouveaux prints (ajoutés une seule fois).
insert into public.produits (titre, annee, texte, image_url, prix_encadre, prix_print, statut, original, ordre)
select v.* from (values
  ('Mordekhai The Jew', '2021', 'Mordekhaï sortit de chez le roi en habit royal.', 'https://www.emmanuelalimi.com/img/boutique/mordekhai-the-jew-1600.webp', 260, 120, 'disponible', false, 4),
  ('Lekha Dodi', '2022', 'It''s all about love.', 'https://www.emmanuelalimi.com/img/boutique/lekha-dodi-1600.webp', 260, 120, 'disponible', false, 5),
  ('Happiness Without Any Reasons', '2024', 'Le bonheur, sans raison.', 'https://www.emmanuelalimi.com/img/boutique/happiness-without-any-reasons-1600.webp', 260, 120, 'disponible', false, 6),
  ('Pray', '2023', 'Chanter, taper des mains, sauter, danser : tout fait partie de la prière.', 'https://www.emmanuelalimi.com/img/boutique/pray-1600.webp', 260, 120, 'disponible', false, 7),
  ('Fishlove', '2023', 'Droite, gauche, droite, gauche : pour avancer, un poisson doit onduler.', 'https://www.emmanuelalimi.com/img/boutique/fishlove-1600.webp', 260, 120, 'disponible', false, 8)
) v(titre, annee, texte, image_url, prix_encadre, prix_print, statut, original, ordre)
where not exists (select 1 from public.produits p where p.titre = v.titre);
