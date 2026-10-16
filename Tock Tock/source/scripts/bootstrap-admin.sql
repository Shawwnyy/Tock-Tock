-- Premier administrateur : à exécuter dans l'éditeur SQL de Supabase (rôle postgres), après la création de VOTRE compte
-- par l'application (connexion par e-mail + pseudonyme). Remplacez l'adresse.
-- L'administrateur n'a AUCUN accès aux données privées (bilans, objectifs, chroniques, conversations) : la RLS ne le permet pas.
insert into public.staff_roles (user_id, role)
select id, 'admin' from auth.users where email = 'VOTRE-ADRESSE@exemple.fr'
on conflict (user_id) do update set role = excluded.role;
-- Ensuite, les autres rôles (modérateur, etc.) s'attribuent depuis l'application via la fonction grant_staff_role (tracée).
