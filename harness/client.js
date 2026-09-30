// DeepSeek Harness browser plugin. The Host serves this bundle through its
// client-module system; React and Cordis are provided by that system.
window.__ModuleLoader__.load({
  id: "smart-delegate",
  factory(require) {
    const React = require("react");
    const { useEffect, useState } = React;
    const h = React.createElement;
    const NS = "smartDelegate";
    const COPY = {
      en: {
        nav: "Delegation", title: "Delegation", intro: "Choose which model handles delegated work. Models connected in Harness appear here automatically.",
        providers: "Providers and models", providersHelp: "Connected providers appear here automatically. Add or manage them in Providers.",
        noProviders: "No Harness model is available yet. Connect a provider in Providers.",
        providerNav: "Providers", providerTitle: "Providers", providerIntro: "Sign in, add an API key, or point Smart Delegate at your own endpoint.", providerSearch: "Search your providers", showing: "Showing", connected: "Connected", needsAttention: "Needs attention", connection: "Connection", signedOut: "Signed out", noAccount: "No account is signed in for this provider.", signInHelp: "Add a subscription sign-in. Stored credentials stay on this device.", modelsHeading: "Models", searchProviderModels: "Search models of", modelsOf: "Models of", editConnection: "Edit connection", noModelResults: "No matching models.", ready: "Ready", keyMissing: "API key needed", unavailableProvider: "Unavailable", connectAnother: "Connect another provider", connectTitle: "Connect a provider", connectIntro: "Choose a provider to set up, or use your own endpoint.", catalogSearch: "Search providers", customEndpoint: "Custom endpoint…", addAnother: "Add another", keyLabel: "API key", keyPlaceholder: "Paste your API key", connect: "Connect", providerName: "Display name", routeId: "Provider ID", endpoint: "Endpoint URL", protocol: "API protocol", modelIds: "Model IDs (one per line)", providerEmpty: "No provider connected yet.", catalogEmpty: "No matching provider.", manage: "Manage", back: "Back", keySaved: "Provider saved in Harness.", nativeSignin: "Connect this account through Harness authorization.", nativeModels: "Open Models", providerCount: "providers", keyHint: "The key is stored in Harness credentials and is never shown again.", customHelp: "Add at least one model ID served by this endpoint.", connectedBadge: "Connected", pointEndpoint: "Point Smart Delegate at any endpoint you host or subscribe to yourself.", signIn: "Sign in", signingIn: "Waiting for sign-in…", signInDone: "Account connected in Harness.", signInCancelled: "Sign-in cancelled.", openPage: "Open sign-in page", authCode: "Code", answer: "Continue", accountMissing: "Sign-in needed", done: "Done",
        lanes: "Lanes", addLane: "Add lane", editLane: "Edit lane", deleteLane: "Delete lane", noLanes: "No lanes yet. Add one to guide delegation.",
        name: "Name", responsibility: "Responsibility", responsibilityHelp: "Describe the work this lane owns; task types below determine automatic matching.",
        taskTypes: "Task types", target: "Agent and model", provider: "Provider", model: "Model", effort: "Reasoning effort", enabled: "Enabled",
        chooseTarget: "Choose an agent and model", noModels: "No model is available for this provider.",
        defaultLane: "Default lane", automatic: "Require an explicit lane if ambiguous", defaultHelp: "Used when no task type matches a single lane. With one enabled lane, that lane handles every task.",
        limits: "Attempt limits", concurrent: "Concurrent delegations per session", concurrentHelp: "Maximum Smart Delegate runs started at the same time from one Harness session.",
        timeout: "Attempt time limit (minutes)", timeoutHelp: "Stops one worker attempt after this time.",
        corrections: "Correction limit", correctionsHelp: "How many correction rounds may follow a failed gate or a reviewer request.",
        save: "Save changes", saveLane: "Save lane", cancel: "Cancel", saved: "Changes saved.", loading: "Loading settings…", retry: "Retry", unavailable: "Model not found", available: "In catalog", cli: "Coding agents", harness: "Harness providers", removeConfirm: "Delete this lane?", invalidName: "Enter a lane name.", invalidTarget: "Choose a model in the current catalog.",
      },
      fr: {
        nav: "Délégation", title: "Délégation", intro: "Choisissez le modèle qui prend en charge chaque travail délégué. Les modèles connectés dans Harness apparaissent ici automatiquement.",
        providers: "Fournisseurs et modèles", providersHelp: "Les fournisseurs connectés apparaissent ici automatiquement. Ajoutez-les et gérez-les dans Fournisseurs.",
        noProviders: "Aucun modèle Harness disponible. Connectez un fournisseur dans Fournisseurs.",
        providerNav: "Fournisseurs", providerTitle: "Fournisseurs", providerIntro: "Connectez-vous, ajoutez une clé API ou indiquez votre propre endpoint.", providerSearch: "Rechercher vos fournisseurs", showing: "Affichage", connected: "Connectés", needsAttention: "À vérifier", connection: "Connexion", signedOut: "Déconnecté", noAccount: "Aucun compte connecté pour ce fournisseur.", signInHelp: "Connectez un abonnement. Les identifiants restent sur cet appareil.", modelsHeading: "Modèles", searchProviderModels: "Rechercher les modèles de", modelsOf: "Modèles de", editConnection: "Modifier la connexion", noModelResults: "Aucun modèle correspondant.", ready: "Prêt", keyMissing: "Clé API requise", unavailableProvider: "Indisponible", connectAnother: "Connecter un autre fournisseur", connectTitle: "Connecter un fournisseur", connectIntro: "Choisissez un fournisseur ou utilisez votre propre endpoint.", catalogSearch: "Rechercher des fournisseurs", customEndpoint: "Endpoint personnalisé…", addAnother: "Ajouter", keyLabel: "Clé API", keyPlaceholder: "Collez votre clé API", connect: "Connecter", providerName: "Nom affiché", routeId: "Identifiant du fournisseur", endpoint: "URL de l’endpoint", protocol: "Protocole API", modelIds: "Identifiants des modèles (un par ligne)", providerEmpty: "Aucun fournisseur connecté.", catalogEmpty: "Aucun fournisseur correspondant.", manage: "Gérer", back: "Retour", keySaved: "Fournisseur enregistré dans Harness.", nativeSignin: "Connectez ce compte avec l’autorisation Harness.", nativeModels: "Ouvrir Modèles", providerCount: "fournisseurs", keyHint: "La clé est conservée par Harness et ne sera plus affichée.", customHelp: "Indiquez au moins un modèle servi par cet endpoint.", connectedBadge: "Connecté", pointEndpoint: "Indiquez tout endpoint que vous hébergez ou auquel vous êtes abonné.", signIn: "Se connecter", signingIn: "Connexion en cours…", signInDone: "Compte connecté dans Harness.", signInCancelled: "Connexion annulée.", openPage: "Ouvrir la page de connexion", authCode: "Code", answer: "Continuer", accountMissing: "Connexion requise", done: "Terminé",
        lanes: "Voies", addLane: "Ajouter une voie", editLane: "Modifier la voie", deleteLane: "Supprimer la voie", noLanes: "Aucune voie. Ajoutez-en une pour guider la délégation.",
        name: "Nom", responsibility: "Responsabilité", responsibilityHelp: "Décrivez le travail de cette voie ; les types de tâches ci-dessous déterminent la sélection automatique.",
        taskTypes: "Types de tâches", target: "Agent et modèle", provider: "Fournisseur", model: "Modèle", effort: "Effort de raisonnement", enabled: "Activée",
        chooseTarget: "Choisir un agent et un modèle", noModels: "Aucun modèle disponible pour ce fournisseur.",
        defaultLane: "Voie par défaut", automatic: "Exiger une voie explicite en cas d’ambiguïté", defaultHelp: "Utilisée si aucun type de tâche ne désigne une seule voie. Une seule voie activée reçoit toutes les tâches.",
        limits: "Limites des tentatives", concurrent: "Délégations simultanées par session", concurrentHelp: "Nombre maximal de tâches Smart Delegate lancées en même temps depuis une session Harness.",
        timeout: "Durée limite par tentative (minutes)", timeoutHelp: "Arrête une tentative de l’agent après cette durée.",
        corrections: "Limite de corrections", correctionsHelp: "Nombre de corrections possibles après un échec de vérification ou une demande de relecture.",
        save: "Enregistrer", saveLane: "Enregistrer la voie", cancel: "Annuler", saved: "Modifications enregistrées.", loading: "Chargement des paramètres…", retry: "Réessayer", unavailable: "Modèle introuvable", available: "Au catalogue", cli: "Agents de code", harness: "Fournisseurs Harness", removeConfirm: "Supprimer cette voie ?", invalidName: "Indiquez un nom pour la voie.", invalidTarget: "Choisissez un modèle du catalogue actuel.",
      },
    };
    const FR_UI = {
      common: { ok: "OK", cancel: "Annuler", close: "Fermer", copy: "Copier", copied: "Copié", retry: "Réessayer", loading: "Chargement…", "load.failed": "Chargement impossible", submit: "Envoyer", next: "Suivant", previous: "Précédent", delete: "Supprimer", edit: "Modifier", save: "Enregistrer", search: "Rechercher", more: "Plus", collapse: "Réduire", expand: "Développer", back: "Retour", "workspace.defaultName": "Espace de travail par défaut", unknown: "Inconnu", none: "Aucun" },
      settings: { trigger: "Paramètres", "shortcut.open": "Ouvrir les paramètres", title: "Paramètres", close: "Fermer", "general.nav": "Général", "general.currentVersion": "Version actuelle : {version}", "developerTools.title": "Afficher la vue de développement", "developerTools.description": "Affiche les étapes, les différences de code et tous les modes", "connection.error": "Déconnecté", "connection.connecting": "Reconnexion", "connection.connected": "Connecté" },
      "settings.locale": { "language.title": "Langue" },
      "settings.theme": { "appearance.title": "Apparence", "appearance.light": "Clair", "appearance.dark": "Sombre", "appearance.system": "Système", "fontSize.title": "Taille du texte", "fontSize.description": "Concerne seulement les conversations", "fontSize.increase": "Augmenter la taille du texte", "fontSize.decrease": "Réduire la taille du texte" },
      "settings.permission": { title: "Autorisations", description: "Choisissez les autorisations par défaut des nouvelles sessions", "preset.readOnly": "Lecture seule", "preset.workspaceWrite": "Écriture dans l’espace de travail", "preset.fullAccess": "Accès complet" },
      "permission.access": { mode: "Mode d’accès actuel : {name}", "preset.readOnly": "Lecture seule", "preset.workspaceWrite": "Écriture dans l’espace de travail", "preset.fullAccess": "Accès complet" },
      "settings.plugins": { nav: "Plugins intégrés", title: "Plugins intégrés", intro: "Consultez les plugins fournis avec cette installation.", tabs: "Vues des plugins", empty: "Aucune vue de plugin disponible." },
      "settings.sessionLog": { title: "Envoyer les journaux de session avec l’API officielle", description: "Aide à améliorer les modèles et produits DeepSeek.", saved: "Préférence enregistrée", failed: "Enregistrement impossible" },
      shortcuts: { title: "Raccourcis clavier", settings: "Raccourcis clavier", view: "Modifier les raccourcis", description: "Consulter et modifier les raccourcis et actions disponibles", search: "Rechercher des raccourcis", close: "Fermer les raccourcis" },
      "settings.agentPreset": { nav: "Modes", seatHint: "Choisir le mode de la nouvelle tâche", headerHint: "Mode choisi au début de cette tâche", sectionIntro: "Choisissez le mode de travail de l’agent.", builtInGroup: "Intégrés", customGroup: "Personnalisés", presetStandardName: "Standard mode", presetStandardDescription: "Travail courant sur le code, les fichiers et les informations, avec recherche, édition et terminal si nécessaire.", setDefault: "Définir par défaut", view: "Voir la configuration", inUse: "Mode par défaut", noDescription: "Aucune description.", close: "Fermer" },
      sidebar: { "session.new": "Nouvelle session", "session.new.label": "Nouvelle session", "toggle.open": "Ouvrir la barre latérale", "toggle.collapse": "Réduire la barre latérale", "panels.label": "Panneaux globaux" },
      workspace: { "workspace.add": "Ajouter un espace de travail", "search.sessions.aria": "Rechercher des sessions", "search.placeholder": "Rechercher des sessions", "menu.addWorkspace": "Ajouter un espace de travail…", "empty.none": "Aucune session", "search.noMatches": "Aucune session correspondante" },
      chat: { "settings.performance.title": "Performances et utilisation", "settings.performance.description": "Choisissez le niveau de détail des performances et de l’utilisation", "settings.performance.compact": "Compact", "settings.performance.detailed": "Détaillé", "settings.transcript.title": "Détails du travail", "settings.transcript.description": "Choisissez le niveau de détail des appels d’outils", "settings.transcript.compact": "Compact", "settings.transcript.standard": "Standard", "settings.transcript.detailed": "Détaillé", "settings.transcript.verbose": "Complet" },
      conversation: { "placeholder.hero": "Décrivez votre projet, / commandes, @ fichiers ou sessions", "placeholder.default": "Écrivez un message ou lancez une tâche", "placeholder.workspace": "Choisissez un espace de travail", "input.commands": "Ajouter des fichiers ou exécuter des commandes", "input.send": "Envoyer le message", "input.stop": "Arrêter la génération", "hero.headline": "Que voulez-vous créer ?", "hero.preview": "Aperçu", "hero.chooseWorkspace": "Choisir un espace de travail", "settings.enter.title": "Envoi pendant une tâche", "settings.enter.description": "Choisissez l’action de la touche Entrée et du bouton Envoyer pendant une tâche ; Cmd/Ctrl+Entrée utilise l’autre action", "settings.enter.queue": "Mettre en attente", "settings.enter.steer": "Orienter" },
    };
    const CATEGORY = ["implementation", "planning", "architecture", "debugging", "bugfix", "review", "tests", "documentation", "security", "performance", "refactor", "ui", "research", "migration", "devops", "database"];
    const STYLE = `
      body[data-ds-dark-theme]{
        --sd-canvas:#181715;--sd-surface:#252320;--sd-surface-raised:#302d29;--sd-border:#514b45;--sd-text:#faf9f5;--sd-muted:#bdb7af;--sd-accent:#cc785c;--sd-accent-hover:#de8c70;--sd-on-accent:#181715;--sd-success:#77c38d;--sd-warning:#e8b56a;--sd-error:#e88983;--sd-hover:#3a342f;--sd-focus:#de8c70;
        --dsw-alias-bg-base:#181715!important;--dsw-alias-bg-layer-1:#211f1c!important;--dsw-alias-bg-layer-2:#252320!important;--dsw-alias-bg-layer-3:#302d29!important;--dsw-alias-bg-module-platform:#302d29!important;
        --dsw-alias-label-primary:#faf9f5!important;--dsw-alias-label-secondary:#d0cac2!important;--dsw-alias-label-tertiary:#bdb7af!important;
        --dsw-alias-border-l1:#ffffff12!important;--dsw-alias-border-l2:#ffffff24!important;--dsw-alias-border-l3:#ffffff36!important;--dsw-alias-border-l4:#ffffff48!important;
        --dsw-alias-settings-card-fill:#252320!important;--dsw-alias-settings-card-stroke:#514b45!important;--dsw-alias-button-primary-fill:#cc785c!important;--dsw-alias-button-primary-hover:#de8c70!important;--dsw-alias-button-info-fill:#cc785c!important;--dsw-alias-button-info-hover:#de8c70!important;--dsw-alias-button-elevated-fill:#302d29!important;
        --dsw-alias-interactive-bg-hover:#cc785c18!important;--dsw-alias-interactive-bg-hover-solid:#3a342f!important;--dsw-alias-interactive-bg-active:#cc785c2e!important;
        --dsw-alias-state-success-primary:#77c38d!important;--dsw-alias-state-warn-primary:#e8b56a!important;--dsw-alias-state-error-primary:#e88983!important;
        --dsw-specific-sidebar-fill:#211f1c!important;--dsw-specific-sidebar-nav-item-active:#3a342f!important;--dsw-specific-sidebar-nav-item-hover:#302d29!important;
      }
      body:not([data-ds-dark-theme]){
        --sd-canvas:#faf9f5;--sd-surface:#f5f0e8;--sd-surface-raised:#efe9de;--sd-border:#dad3cb;--sd-text:#252523;--sd-muted:#625e58;--sd-accent:#a9583e;--sd-accent-hover:#8f462f;--sd-on-accent:#fff;--sd-success:#286c40;--sd-warning:#8a5d18;--sd-error:#a83832;--sd-hover:#e8e0d2;--sd-focus:#a9583e;
        --dsw-alias-bg-base:#faf9f5!important;--dsw-alias-bg-layer-1:#f5f0e8!important;--dsw-alias-bg-layer-2:#efe9de!important;--dsw-alias-bg-layer-3:#e8e0d2!important;--dsw-alias-bg-module-platform:#efe9de!important;
        --dsw-alias-label-primary:#252523!important;--dsw-alias-label-secondary:#3d3d3a!important;--dsw-alias-label-tertiary:#625e58!important;
        --dsw-alias-border-l1:#14141312!important;--dsw-alias-border-l2:#14141324!important;--dsw-alias-border-l3:#14141336!important;--dsw-alias-border-l4:#14141348!important;
        --dsw-alias-settings-card-fill:#f5f0e8!important;--dsw-alias-settings-card-stroke:#dad3cb!important;--dsw-alias-button-primary-fill:#a9583e!important;--dsw-alias-button-primary-hover:#8f462f!important;--dsw-alias-button-info-fill:#a9583e!important;--dsw-alias-button-info-hover:#8f462f!important;--dsw-alias-button-elevated-fill:#efe9de!important;
        --dsw-alias-interactive-bg-hover:#a9583e18!important;--dsw-alias-interactive-bg-hover-solid:#e8e0d2!important;--dsw-alias-interactive-bg-active:#a9583e2e!important;
        --dsw-alias-state-success-primary:#286c40!important;--dsw-alias-state-warn-primary:#8a5d18!important;--dsw-alias-state-error-primary:#a83832!important;
        --dsw-specific-sidebar-fill:#f5f0e8!important;--dsw-specific-sidebar-nav-item-active:#e8e0d2!important;--dsw-specific-sidebar-nav-item-hover:#efe9de!important;
      }
      .me01iq_action{display:none!important}
      .VOzbGW_navList>.VOzbGW_navCell:nth-child(2){display:none!important}
      .hVGvvW_row{display:none!important}
      .sd-language-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-size:14px}
      .sd-language-row select{min-width:126px;height:36px;border:1px solid var(--sd-border);border-radius:6px;padding:0 10px;background:var(--sd-surface-raised);color:var(--sd-text);font:inherit;cursor:pointer}
      .sd-language-row select:focus-visible{outline:2px solid var(--sd-focus);outline-offset:2px}
      .sd-page{max-width:860px;padding:12px 4px 30px;color:var(--dsw-alias-label-primary,var(--sd-text));font:14px/1.45 system-ui,sans-serif}
      .sd-page h2{font-size:21px;letter-spacing:-.03em;margin:0 0 5px}.sd-page h3{font-size:15px;margin:0}
      .sd-intro,.sd-help,.sd-meta{color:var(--dsw-alias-label-secondary,var(--sd-muted))}.sd-intro{margin:0 0 25px}
      .sd-flow{display:flex;align-items:center;gap:8px;margin:0 0 23px;font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--sd-muted)}
      .sd-flow i{height:1px;min-width:18px;max-width:55px;flex:1;background:var(--sd-border)}
      .sd-section{border-top:1px solid var(--dsw-alias-border-l2,var(--sd-border));padding:21px 0 23px}
      .sd-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:11px}.sd-help{font-size:12px;margin:4px 0 14px;max-width:610px}
      .sd-provider-list{display:flex;flex-wrap:wrap;gap:7px}.sd-provider{border:1px solid var(--sd-border);border-radius:7px;padding:5px 9px;background:var(--sd-surface);color:var(--sd-text);font-size:12px}.sd-provider b{color:var(--sd-muted);margin-right:5px}
      .sd-lane{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;border:1px solid var(--sd-border);background:var(--sd-surface);border-radius:9px;padding:13px;margin:9px 0}.sd-lane strong{display:block;font-size:14px}.sd-lane .sd-meta{display:block;margin-top:3px;font-size:12px;overflow-wrap:anywhere}.sd-lane-actions{display:flex;align-items:center;gap:6px}
      .sd-button{background:transparent;border:1px solid var(--sd-border);color:var(--sd-text);border-radius:6px;padding:6px 10px;font:inherit;font-size:12px;cursor:pointer}.sd-button:hover{background:var(--sd-hover)}.sd-button:disabled{opacity:.5;cursor:default}.sd-button.primary{background:var(--sd-accent);border-color:var(--sd-accent);color:var(--sd-on-accent);font-weight:650}.sd-button.danger{color:var(--sd-error);border-color:var(--sd-error)}
      .sd-form{border:1px solid var(--sd-border);background:var(--sd-surface);border-radius:9px;padding:16px;margin:12px 0}.sd-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px}.sd-field{display:block;min-width:0}.sd-field>span{display:block;font-weight:600;font-size:12px;margin-bottom:5px}.sd-field input,.sd-field select,.sd-field textarea,.sd-page select,.sd-page input[type=number]{width:100%;box-sizing:border-box;background:var(--sd-surface-raised);color:var(--sd-text);border:1px solid var(--sd-border);border-radius:6px;padding:8px 9px;font:inherit;font-size:13px}.sd-field textarea{min-height:64px;resize:vertical}.sd-field input:focus-visible,.sd-field select:focus-visible,.sd-field textarea:focus-visible,.sd-page select:focus-visible,.sd-page input:focus-visible,.sd-button:focus-visible{outline:2px solid var(--sd-focus);outline-offset:2px}
      .sd-categories{display:flex;gap:6px;flex-wrap:wrap}.sd-category{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--sd-border);border-radius:6px;padding:5px 7px;font-size:11px}.sd-category:has(input:checked){background:var(--sd-surface-raised);border-color:var(--sd-accent)}.sd-category input{accent-color:var(--sd-accent)}
      .sd-actions{display:flex;gap:8px;align-items:center;margin-top:14px}.sd-number-row{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:15px;align-items:center;padding:10px 0;border-bottom:1px solid var(--sd-border)}.sd-number-row:last-child{border-bottom:0}.sd-number-row strong{font-size:13px}.sd-number-row p{margin:3px 0 0;color:var(--sd-muted);font-size:12px}.sd-error{color:var(--sd-error);font-size:12px;margin:8px 0}.sd-success{color:var(--sd-success);font-size:12px;margin:8px 0}.sd-empty{border:1px dashed var(--sd-border);border-radius:8px;color:var(--sd-muted);padding:16px;font-size:12px}
      .sd-providers{max-width:none}.sd-provider-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:24px}.sd-provider-head .sd-intro{margin:4px 0 0}.sd-provider-toolbar{display:flex;align-items:center;gap:9px;max-width:720px;margin-bottom:13px}.sd-provider-toolbar input,.sd-modal input,.sd-modal textarea,.sd-modal select{box-sizing:border-box;width:100%;height:34px;border:1px solid var(--sd-border);border-radius:6px;padding:6px 10px;background:var(--sd-surface-raised);color:var(--sd-text);font:inherit}.sd-provider-toolbar input{flex:1}.sd-provider-toolbar small{white-space:nowrap;color:var(--sd-muted)}.sd-group-label{margin:14px 0 7px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--sd-muted)}.sd-connection-list{max-width:720px;border:1px solid var(--sd-border);border-radius:10px;overflow:hidden}.sd-connection{display:flex;align-items:center;gap:12px;width:100%;min-height:56px;background:var(--sd-surface);border:0;border-bottom:1px solid var(--sd-border);color:var(--sd-text);text-align:left;padding:9px 15px;cursor:pointer;font:inherit}.sd-connection:last-child{border-bottom:0}.sd-connection:hover{background:var(--sd-hover)}.sd-connection-name{flex:1;min-width:0}.sd-connection-name strong{display:block;font-size:13px}.sd-connection-name small{display:block;color:var(--sd-muted);font-size:11px;margin-top:2px}.sd-status{font-size:12px;font-weight:650}.sd-status.ready{color:var(--sd-success)}.sd-status.missing{color:var(--sd-warning)}.sd-status.offline{color:var(--sd-error)}.sd-modal-backdrop{position:fixed;inset:0;background:rgba(24,23,21,.78);z-index:1100;display:flex;align-items:center;justify-content:center;padding:18px}.sd-modal{box-sizing:border-box;width:min(520px,100%);max-height:min(790px,calc(100vh - 36px));overflow:auto;border:1px solid var(--sd-border);border-radius:12px;background:var(--sd-surface-raised);color:var(--sd-text);box-shadow:0 24px 80px rgba(0,0,0,.5);padding:20px 24px}.sd-modal h3{font-size:16px;margin:0}.sd-modal p{font-size:12px;color:var(--sd-muted)}.sd-modal-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}.sd-modal-list{max-height:500px;overflow:auto;margin:13px 0}.sd-catalog-row{display:flex;gap:8px;align-items:center;margin:3px 0}.sd-catalog-name{flex:1;min-width:0;border:1px solid var(--sd-border);border-radius:6px;background:var(--sd-surface);color:var(--sd-text);padding:8px 10px;font:inherit;font-size:13px;font-weight:600;text-align:left;cursor:pointer}.sd-catalog-name:hover{background:var(--sd-hover)}.sd-catalog-name:focus-visible{outline:2px solid var(--sd-focus);outline-offset:2px}.sd-modal .sd-field{margin:11px 0}.sd-modal textarea{min-height:78px;resize:vertical}.sd-modal-actions{display:flex;justify-content:space-between;gap:8px;margin-top:20px}.sd-modal-actions>span{flex:1}.sd-modal .sd-help{margin:5px 0}.sd-provider-head .sd-button{white-space:nowrap}
      .sd-catalog-name small{display:block;margin-top:2px;color:var(--sd-success);font-size:11px;font-weight:600}.sd-catalog-name em{display:block;margin-top:2px;color:var(--sd-muted);font-size:11px;font-style:normal;font-weight:400}
      .sd-auth-code{display:block;width:fit-content;margin-top:8px;border:1px solid var(--sd-border);border-radius:6px;padding:7px 10px;color:var(--sd-text);font:600 14px ui-monospace,monospace}.sd-auth-link{display:block;width:fit-content;margin-top:8px;color:var(--sd-accent);text-decoration:underline;text-underline-offset:3px}
      .sd-provider-group{max-width:720px;margin:0 0 14px}.sd-provider-card{border:1px solid var(--sd-border);border-radius:10px;background:var(--sd-surface);overflow:hidden}.sd-provider-card+.sd-provider-card{margin-top:8px}.sd-provider-card-head{width:100%;display:flex;align-items:center;gap:14px;min-height:56px;padding:10px 16px;border:0;background:transparent;color:var(--sd-text);text-align:left;font:inherit;cursor:pointer}.sd-provider-card-head:hover{background:var(--sd-hover)}.sd-provider-card-head:focus-visible{outline:2px solid var(--sd-focus);outline-offset:-3px}.sd-provider-dot{width:7px;height:7px;border-radius:50%;background:var(--sd-warning);flex:none}.sd-provider-dot.ready{background:var(--sd-success)}.sd-provider-card-head .sd-connection-name{flex:1}.sd-provider-card-head .sd-status{margin-left:auto}.sd-provider-card-body{border-top:1px dashed var(--sd-border);padding:12px 14px 16px;font-size:12px}.sd-provider-card-body h3{font-size:12px;color:var(--sd-muted);margin:0 0 7px}.sd-provider-card-body p{margin:6px 0;color:var(--sd-muted)}.sd-provider-account{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:19px 0 9px}.sd-provider-account strong{font-size:13px}.sd-provider-account small{font-size:11px;color:var(--sd-muted)}.sd-provider-models{border-top:1px solid var(--sd-border);margin-top:26px;padding-top:12px}.sd-provider-models-title{display:flex;align-items:center;gap:7px;font-weight:700;margin-bottom:12px}.sd-provider-model-toolbar{display:flex;align-items:center;gap:9px}.sd-provider-model-toolbar input{min-width:0;flex:1;box-sizing:border-box;background:var(--sd-surface-raised);border:1px solid var(--sd-border);border-radius:6px;color:var(--sd-text);padding:7px 9px;font:inherit}.sd-provider-model-toolbar small{white-space:nowrap;color:var(--sd-muted)}.sd-provider-model-list{max-height:260px;overflow:auto;margin-top:9px}.sd-provider-model-row{display:flex;align-items:center;gap:12px;padding:9px 8px;border-bottom:1px solid var(--sd-border);cursor:pointer}.sd-provider-model-row:last-child{border-bottom:0}.sd-provider-model-row span{flex:1;min-width:0}.sd-provider-model-row strong{display:block;font-size:13px}.sd-provider-model-row small{display:block;color:var(--sd-muted);font-size:11px;margin-top:3px}.sd-provider-model-row input{appearance:none;width:35px;height:20px;border-radius:20px;border:1px solid var(--sd-border);background:var(--sd-surface-raised);position:relative;cursor:pointer;flex:none}.sd-provider-model-row input:before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--sd-text);transition:transform .15s}.sd-provider-model-row input:checked{background:var(--sd-text)}.sd-provider-model-row input:checked:before{background:var(--sd-on-accent);transform:translateX(15px)}.sd-provider-model-row input:focus-visible{outline:2px solid var(--sd-focus);outline-offset:2px}
      .sd-page h2{font:400 26px/1.2 Georgia,"Times New Roman",serif;letter-spacing:-.025em}
      .sd-page h3,.sd-modal h3{letter-spacing:-.01em}
      .sd-provider-card,.sd-lane,.sd-modal{box-shadow:0 2px 12px rgba(0,0,0,.08)}
      .sd-button.primary:hover:not(:disabled){background:var(--sd-accent-hover);border-color:var(--sd-accent-hover)}
      .sd-provider-model-row:hover,.sd-provider-card-head:hover{background:var(--sd-hover)}
      @media(max-width:650px){.sd-grid{grid-template-columns:1fr}.sd-lane{grid-template-columns:1fr}.sd-flow{flex-wrap:wrap}.sd-number-row{grid-template-columns:1fr 85px}}
      @media(max-width:650px){.sd-provider-head{flex-direction:column}.sd-provider-toolbar{flex-wrap:wrap}.sd-provider-toolbar small{width:100%}.sd-modal{padding:16px}.sd-provider-model-toolbar{flex-wrap:wrap}.sd-provider-model-toolbar small{width:100%}}
      @media(prefers-reduced-motion:no-preference){.sd-button{transition:background .15s ease}}
    `;

    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, COPY), "smart-delegate: dictionaries");
      ctx.effect(() => ctx.locale.addLanguage({ id: "fr", label: "Français", fallback: "en" }), "smart-delegate: French language");
      for (const [namespace, dictionary] of Object.entries(FR_UI)) {
        ctx.effect(() => ctx.locale.register(namespace, "fr", dictionary), `smart-delegate: ${namespace} French copy`);
      }
      if (ctx.locale.getSnapshot().active === "zh") ctx.locale.setLocale("fr");
      ctx.effect(() => {
        const style = document.createElement("style");
        style.dataset.plugin = "smart-delegate";
        style.textContent = STYLE;
        document.head.append(style);
        return () => style.remove();
      }, "smart-delegate: styles");

      function LanguageSetting() {
        const [active, setActive] = useState(ctx.locale.getSnapshot().active);
        useEffect(() => ctx.locale.subscribe(() => setActive(ctx.locale.getSnapshot().active)), []);
        return h("label", { className: "sd-language-row" },
          h("span", null, active === "fr" ? "Langue" : "Language"),
          h("select", { value: active === "fr" ? "fr" : "en", onChange: (event) => ctx.locale.setLocale(event.target.value), "aria-label": active === "fr" ? "Langue" : "Language" },
            h("option", { value: "en" }, "English"), h("option", { value: "fr" }, "Français")));
      }

      const emptyDraft = () => ({ id: "", name: "", responsibility: "", categories: [], agent: "", provider: null, model: null, reasoningEffort: null, enabled: true });
      const slug = (value) => value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
      const targetKey = (lane) => lane.agent === "deepseek-harness" ? `h:${lane.provider}` : lane.agent ? `a:${lane.agent}:${lane.model ?? ""}` : "";
      const providerOf = (data, id) => data.providers.find((p) => p.id === id);
      const laneAvailable = (data, lane) => lane.agent === "deepseek-harness"
        ? Boolean(providerOf(data, lane.provider)?.models.some((m) => m.id === lane.model))
        : data.agentModels.some((m) => m.agent === lane.agent && m.model === lane.model && m.enabled);

      function openNativeModels() {
        const row = [...document.querySelectorAll("button")].find((button) => ["Models", "Modèles"].includes(button.textContent.trim()));
        row?.click();
      }

      function ProvidersSection() {
        const [data, setData] = useState(null);
        const [error, setError] = useState("");
        const [notice, setNotice] = useState("");
        const [query, setQuery] = useState("");
        const [catalogQuery, setCatalogQuery] = useState("");
        const [modal, setModal] = useState(null);
        const [draft, setDraft] = useState(null);
        const [busy, setBusy] = useState(false);
        const [authAttempt, setAuthAttempt] = useState(null);
        const [authState, setAuthState] = useState(null);
        const [authAnswer, setAuthAnswer] = useState("");
        const [expandedProvider, setExpandedProvider] = useState(null);
        const [modelQuery, setModelQuery] = useState("");
        const [modelBusy, setModelBusy] = useState(null);
        const load = async () => {
          try {
            const response = await fetch("/api/smart-delegate/providers", { credentials: "same-origin" });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData(value); setError("");
          } catch (cause) { setError(cause.message); }
        };
        useEffect(() => { load(); }, []);
        useEffect(() => {
          if (!authAttempt) return;
          let mounted = true;
          const poll = async () => {
            try {
              const response = await fetch(`/api/smart-delegate/authorization?id=${encodeURIComponent(authAttempt)}`, { credentials: "same-origin" });
              const value = await response.json();
              if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
              if (!mounted) return;
              setAuthState(value);
              if (value.status !== "pending") { clearInterval(timer); if (value.status === "authorized") await load(); }
            } catch (cause) { if (mounted) { clearInterval(timer); setError(cause.message); } }
          };
          const timer = setInterval(poll, 1000);
          void poll();
          return () => { mounted = false; clearInterval(timer); };
        }, [authAttempt]);
        const closeModal = () => {
          if (modal === "authorize" && authAttempt && authState?.status === "pending") {
            void fetch("/api/smart-delegate/authorization", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: authAttempt }) });
          }
          setModal(null); setAuthAttempt(null); setAuthState(null); setAuthAnswer("");
        };
        const choose = (id, custom = false) => {
          const current = data?.connected.find((item) => item.id === id);
          setDraft({ id, name: current?.name ?? "", baseURL: current?.baseURL ?? "", api: current?.api || "openai-completions", models: current?.models.join("\n") ?? "", apiKey: "", custom: custom || current?.custom || false, oauth: data?.catalog.find((item) => item.id === id)?.oauth ?? false });
          setModal("edit"); setError("");
        };
        const selectCatalogProvider = async (item) => {
          if (item.native) { setModal(null); openNativeModels(); return; }
          if (!item.oauth) { choose(item.id); return; }
          setBusy(true); setError("");
          try {
            const response = await fetch("/api/smart-delegate/providers", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prepare", id: item.id }) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData(value); setExpandedProvider(item.id); setModelQuery(""); setModal(null);
          } catch (cause) { setError(cause.message); }
          finally { setBusy(false); }
        };
        const startSignIn = async (provider = draft?.id) => {
          setBusy(true); setError("");
          try {
            const response = await fetch("/api/smart-delegate/authorization", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider }) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setAuthAttempt(value.id); setAuthState(value); setModal("authorize");
          } catch (cause) { setError(cause.message); }
          finally { setBusy(false); }
        };
        const answerPrompt = async () => {
          setBusy(true); setError("");
          try {
            const response = await fetch("/api/smart-delegate/authorization", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "answer", id: authAttempt, promptId: authState.prompt.id, answer: authAnswer }) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setAuthState(value); setAuthAnswer("");
          } catch (cause) { setError(cause.message); }
          finally { setBusy(false); }
        };
        const saveProvider = async () => {
          setBusy(true); setError(""); setNotice("");
          try {
            const payload = { ...draft, models: draft.models.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean) };
            const response = await fetch("/api/smart-delegate/providers", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData(value); setExpandedProvider(draft.id); setDraft(null); setModal(null); setNotice(t("keySaved"));
          } catch (cause) { setError(cause.message); }
          finally { setBusy(false); }
        };
        const toggleModel = async (provider, model, enabled) => {
          setModelBusy(`${provider}:${model}`); setError("");
          try {
            const response = await fetch("/api/smart-delegate/providers", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "toggle-model", id: provider, model, enabled }) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData(value);
          } catch (cause) { setError(cause.message); }
          finally { setModelBusy(null); }
        };
        const connected = data?.connected.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query.toLowerCase())) ?? [];
        const attention = connected.filter((item) => !item.ready);
        const ready = connected.filter((item) => item.ready);
        const catalog = data?.catalog.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(catalogQuery.toLowerCase())) ?? [];
        const accountProvider = Boolean(draft?.oauth);
        const renderProvider = (item) => {
          const expanded = expandedProvider === item.id;
          const oauth = data?.catalog.find((entry) => entry.id === item.id)?.oauth;
          const accountName = item.id === "openai-codex" ? "OpenAI Codex" : item.name;
          const models = (item.availableModels ?? []).filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(modelQuery.toLowerCase()));
          return h("div", { className: "sd-provider-card", key: item.id },
            h("button", { type: "button", className: "sd-provider-card-head", "aria-expanded": expanded, onClick: () => { setExpandedProvider(expanded ? null : item.id); setModelQuery(""); } },
              h("span", { className: `sd-provider-dot ${item.ready ? "ready" : ""}`, "aria-hidden": true }),
              h("span", { className: "sd-connection-name" }, h("strong", null, item.name), h("small", null, oauth ? t("signIn") : item.custom ? item.baseURL : item.id)),
              h("span", { className: `sd-status ${item.ready ? "ready" : "missing"}` }, item.ready ? t("ready") : oauth && item.accountRequired ? t("signedOut") : item.keyRequired ? t("keyMissing") : t("unavailableProvider")),
              h("span", { "aria-hidden": true }, expanded ? "⌄" : "›")),
            expanded && h("div", { className: "sd-provider-card-body" },
              h("h3", null, t("connection")),
              oauth && item.accountRequired ? h(React.Fragment, null,
                h("p", null, t("noAccount")), h("p", null, t("signInHelp")),
                h("div", { className: "sd-provider-account" }, h("strong", null, accountName, "  ", h("small", null, `llm-pi-ai/${item.id}`)), h("small", null, t("signedOut"))),
                h("button", { className: "sd-button primary", onClick: () => startSignIn(item.id), disabled: busy }, t("signIn")))
              : h(React.Fragment, null,
                h("p", null, item.ready ? t("ready") : item.keyRequired ? t("keyMissing") : t("unavailableProvider")),
                h("button", { className: "sd-button", onClick: () => choose(item.id) }, t("editConnection"))),
              h("div", { className: "sd-provider-models" },
                h("div", { className: "sd-provider-models-title" }, t("modelsHeading"), h("span", null, item.availableModels?.length ?? 0)),
                h("div", { className: "sd-provider-model-toolbar" }, h("input", { value: modelQuery, onChange: (event) => setModelQuery(event.target.value), placeholder: `${t("searchProviderModels")} ${item.id}`, "aria-label": `${t("searchProviderModels")} ${item.id}` }), h("small", null, `${t("modelsOf")} ${item.id}`)),
                models.length ? h("div", { className: "sd-provider-model-list" }, models.map((model) => h("label", { className: "sd-provider-model-row", key: model.id },
                  h("span", null, h("strong", null, model.name), h("small", null, model.id)),
                  h("input", { type: "checkbox", role: "switch", checked: model.enabled, disabled: Boolean(modelBusy) || !item.toggleable || !data.writable, onChange: (event) => toggleModel(item.id, model.id, event.target.checked), "aria-label": `${model.name} ${t("enabled")}` }))))
                  : h("p", { className: "sd-help" }, t("noModelResults")))));
        };
        return h("div", { className: "sd-page sd-providers" },
          h("div", { className: "sd-provider-head" }, h("div", null, h("h2", null, t("providerTitle")), h("p", { className: "sd-intro" }, t("providerIntro"))), h("button", { className: "sd-button primary", onClick: () => { setCatalogQuery(""); setModal("catalog"); setError(""); }, disabled: !data?.writable }, `+ ${t("connectAnother")}`)),
          h("div", { className: "sd-provider-toolbar" }, h("input", { value: query, onChange: (event) => setQuery(event.target.value), placeholder: t("providerSearch"), "aria-label": t("providerSearch") }), h("small", null, `${t("showing")} ${connected.length} / ${data?.connected.length ?? 0}`)),
          !data && !error && h("p", { className: "sd-help" }, t("loading")),
          data && h(React.Fragment, null,
            attention.length > 0 && h("div", { className: "sd-provider-group" }, h("div", { className: "sd-group-label" }, `${t("needsAttention")}  ${attention.length}`), attention.map(renderProvider)),
            h("div", { className: "sd-provider-group" }, h("div", { className: "sd-group-label" }, `${t("connected")}  ${ready.length}`), ready.length ? ready.map(renderProvider) : !attention.length && h("p", { className: "sd-empty" }, t("providerEmpty")))),
          !modal && error && h("p", { className: "sd-error", role: "alert" }, error), notice && h("p", { className: "sd-success", role: "status" }, notice),
          modal && h("div", { className: "sd-modal-backdrop", onMouseDown: (event) => { if (event.target === event.currentTarget && !busy) closeModal(); } }, h("div", { className: "sd-modal", role: "dialog", "aria-modal": true, "aria-label": modal === "catalog" ? t("connectTitle") : draft?.name || draft?.id || t("customEndpoint") },
            h("div", { className: "sd-modal-head" }, h("div", null, h("h3", null, modal === "catalog" ? t("connectTitle") : draft?.name || draft?.id || t("customEndpoint")), h("p", null, modal === "catalog" ? t("connectIntro") : draft?.id)), h("button", { className: "sd-button", onClick: closeModal, disabled: busy, "aria-label": t("cancel") }, "×")),
            modal === "authorize" ? h(React.Fragment, null,
              h("p", { className: authState?.status === "authorized" ? "sd-success" : "sd-help", role: "status" }, authState?.status === "authorized" ? t("signInDone") : authState?.status === "cancelled" ? t("signInCancelled") : authState?.status === "failed" ? authState.error : t("signingIn")),
              authState?.notices.map((item, index) => h("p", { className: "sd-help", key: index }, item.message, item.code && h("strong", { className: "sd-auth-code" }, `${t("authCode")}: ${item.code}`), item.url && /^https?:\/\//.test(item.url) && h("a", { className: "sd-auth-link", href: item.url, target: "_blank", rel: "noopener noreferrer" }, t("openPage")))),
              authState?.prompt && h("div", { className: "sd-field" }, h("span", null, authState.prompt.message), authState.prompt.kind === "select" ? h("select", { value: authAnswer, onChange: (event) => setAuthAnswer(event.target.value) }, h("option", { value: "" }, "—"), authState.prompt.options.map((item) => h("option", { key: item.id, value: item.id }, item.label))) : h("input", { type: authState.prompt.kind === "secret" ? "password" : "text", value: authAnswer, onChange: (event) => setAuthAnswer(event.target.value), placeholder: authState.prompt.placeholder || "" }), h("button", { className: "sd-button primary", onClick: answerPrompt, disabled: busy || !authAnswer, style: { marginTop: 8 } }, t("answer"))),
              error && h("p", { className: "sd-error", role: "alert" }, error),
              h("div", { className: "sd-modal-actions" }, h("span"), h("button", { className: "sd-button", onClick: closeModal }, authState?.status === "pending" ? t("cancel") : t("done"))))
              : modal === "catalog" ? h(React.Fragment, null,
              h("input", { value: catalogQuery, onChange: (event) => setCatalogQuery(event.target.value), placeholder: t("catalogSearch"), "aria-label": t("catalogSearch") }),
              h("p", { className: "sd-help" }, `${data?.catalog.length ?? 0} ${t("providerCount")}`),
              h("p", { className: "sd-help" }, t("pointEndpoint")),
              h("div", { className: "sd-modal-list" }, catalog.length ? catalog.map((item) => h("div", { className: "sd-catalog-row", key: item.id }, h("button", { type: "button", className: "sd-catalog-name", onClick: () => selectCatalogProvider(item) }, item.name, item.native && h("em", null, item.id), data.connected.some((row) => row.id === item.id) && h("small", null, t("connectedBadge"))), h("button", { type: "button", className: "sd-button", onClick: () => selectCatalogProvider(item) }, t("addAnother")))) : h("p", { className: "sd-help" }, t("catalogEmpty"))),
              h("div", { className: "sd-modal-actions" }, h("button", { className: "sd-button", onClick: () => choose("", true) }, t("customEndpoint")), h("span"), h("button", { className: "sd-button", onClick: closeModal }, t("cancel"))))
              : h(React.Fragment, null,
                draft?.custom && h(React.Fragment, null,
                  h("label", { className: "sd-field" }, h("span", null, t("routeId")), h("input", { value: draft.id, disabled: data?.connected.some((item) => item.id === draft.id), onChange: (event) => setDraft({ ...draft, id: event.target.value }) })),
                  h("label", { className: "sd-field" }, h("span", null, t("providerName")), h("input", { value: draft.name, onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
                  h("label", { className: "sd-field" }, h("span", null, t("endpoint")), h("input", { value: draft.baseURL, onChange: (event) => setDraft({ ...draft, baseURL: event.target.value }), placeholder: "https://api.example.com/v1" })),
                  h("label", { className: "sd-field" }, h("span", null, t("protocol")), h("select", { value: draft.api, onChange: (event) => setDraft({ ...draft, api: event.target.value }) }, data?.protocols.map((item) => h("option", { key: item, value: item }, item)))),
                  h("label", { className: "sd-field" }, h("span", null, t("modelIds")), h("textarea", { value: draft.models, onChange: (event) => setDraft({ ...draft, models: event.target.value }), placeholder: "my-model" })), h("p", { className: "sd-help" }, t("customHelp"))),
                !accountProvider && h(React.Fragment, null, h("label", { className: "sd-field" }, h("span", null, t("keyLabel")), h("input", { type: "password", autoComplete: "new-password", value: draft?.apiKey ?? "", onChange: (event) => setDraft({ ...draft, apiKey: event.target.value }), placeholder: t("keyPlaceholder") })), h("p", { className: "sd-help" }, t("keyHint"))),
                accountProvider && h("p", { className: "sd-help" }, t("nativeSignin")),
                error && h("p", { className: "sd-error", role: "alert" }, error),
                h("div", { className: "sd-modal-actions" }, h("button", { className: "sd-button", onClick: () => setModal("catalog"), disabled: busy }, t("back")), h("span"), accountProvider ? h("button", { className: "sd-button primary", onClick: () => startSignIn(), disabled: busy }, busy ? t("signingIn") : t("signIn")) : h("button", { className: "sd-button primary", onClick: saveProvider, disabled: busy }, busy ? t("loading") : t("connect")))))));
      }

      function SettingsSection() {
        const [data, setData] = useState(null);
        const [draft, setDraft] = useState(null);
        const [editing, setEditing] = useState(null);
        const [error, setError] = useState("");
        const [notice, setNotice] = useState("");
        const [busy, setBusy] = useState(false);
        const reload = async () => {
          setError("");
          try {
            const response = await fetch("/api/smart-delegate/settings", { credentials: "same-origin" });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData(value);
          } catch (cause) { setError(cause.message); }
        };
        useEffect(() => { reload(); }, []);
        const save = async (settings) => {
          setBusy(true); setError(""); setNotice("");
          try {
            const response = await fetch("/api/smart-delegate/settings", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: data.revision, delegation: settings }) });
            const value = await response.json();
            if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`);
            setData({ ...data, ...value }); setNotice(t("saved"));
            return true;
          } catch (cause) { if (cause.message.includes("changed elsewhere")) await reload(); setError(cause.message); return false; }
          finally { setBusy(false); }
        };
        if (!data) return h("div", { className: "sd-page" }, h("p", null, t("loading")), error && h("p", { className: "sd-error" }, error), h("button", { className: "sd-button", onClick: reload }, t("retry")));
        const settings = data.delegation;
        const setSetting = (key, value) => setData({ ...data, delegation: { ...settings, [key]: value } });
        const edit = (lane) => { setDraft({ ...lane, categories: [...lane.categories] }); setEditing(lane.id); setError(""); };
        const create = () => { setDraft(emptyDraft()); setEditing(""); setError(""); };
        const saveDraft = async () => {
          const lane = { ...draft, id: editing || slug(draft.name) };
          if (!lane.name.trim() || !lane.id) return setError(t("invalidName"));
          if (!lane.agent || !laneAvailable(data, lane)) return setError(t("invalidTarget"));
          const duplicate = settings.lanes.some((item) => item.id === lane.id && item.id !== editing);
          if (duplicate) return setError("A lane with this name already exists.");
          const lanes = editing ? settings.lanes.map((item) => item.id === editing ? lane : item) : [...settings.lanes, lane];
          if (await save({ ...settings, lanes })) { setDraft(null); setEditing(null); }
        };
        const remove = async (lane) => {
          if (!window.confirm(t("removeConfirm"))) return;
          await save({ ...settings, lanes: settings.lanes.filter((item) => item.id !== lane.id), defaultLane: settings.defaultLane === lane.id ? null : settings.defaultLane });
        };
        const toggle = async (lane) => {
          const enabled = !lane.enabled;
          await save({ ...settings, lanes: settings.lanes.map((item) => item.id === lane.id ? { ...item, enabled } : item), defaultLane: !enabled && settings.defaultLane === lane.id ? null : settings.defaultLane });
        };
        const target = draft ? targetKey(draft) : "";
        const selectedProvider = draft?.agent === "deepseek-harness" ? providerOf(data, draft.provider) : null;
        return h("div", { className: "sd-page" },
          h("h2", null, t("title")), h("p", { className: "sd-intro" }, t("intro")),
          h("div", { className: "sd-flow", "aria-hidden": true }, h("span", null, t("providers")), h("i"), h("span", null, t("model")), h("i"), h("span", null, t("lanes")), h("i"), h("span", null, "Run")),
          h("section", { className: "sd-section" }, h("div", { className: "sd-heading" }, h("h3", null, t("providers"))), h("p", { className: "sd-help" }, t("providersHelp")),
            data.providers.some((p) => p.models.length) ? h("div", { className: "sd-provider-list" }, data.providers.filter((p) => p.models.length).map((p) => h("span", { className: "sd-provider", key: p.id }, h("b", null, "●"), p.name, ` · ${p.models.length}`))) : h("div", { className: "sd-empty" }, t("noProviders"))),
          h("section", { className: "sd-section" }, h("div", { className: "sd-heading" }, h("h3", null, t("lanes")), h("button", { className: "sd-button", onClick: create, disabled: busy || Boolean(draft) }, t("addLane"))),
            !settings.lanes.length && h("div", { className: "sd-empty" }, t("noLanes")),
            settings.lanes.map((lane) => h("div", { className: "sd-lane", key: lane.id },
              h("div", null, h("strong", null, lane.name), h("span", { className: "sd-meta" }, `${lane.provider ? `${lane.provider} / ` : ""}${lane.model ?? lane.agent} · ${lane.categories.join(", ") || lane.responsibility || "—"}`), h("span", { className: "sd-meta", style: { color: laneAvailable(data, lane) ? "#60d497" : "#ffc47b" } }, laneAvailable(data, lane) ? t("available") : t("unavailable"))),
              h("div", { className: "sd-lane-actions" }, h("input", { type: "checkbox", checked: lane.enabled, onChange: () => toggle(lane), "aria-label": `${t("enabled")} ${lane.name}`, disabled: busy }), h("button", { className: "sd-button", onClick: () => edit(lane), disabled: busy || Boolean(draft) }, t("editLane")), h("button", { className: "sd-button danger", onClick: () => remove(lane), disabled: busy }, t("deleteLane"))))),
            draft && h("div", { className: "sd-form" }, h("h3", null, editing ? t("editLane") : t("addLane")),
              h("div", { className: "sd-grid", style: { marginTop: 12 } },
                h("label", { className: "sd-field" }, h("span", null, t("name")), h("input", { value: draft.name, maxLength: 80, placeholder: "Implementation", onChange: (event) => setDraft({ ...draft, name: event.target.value }) })),
                h("label", { className: "sd-field" }, h("span", null, t("target")), h("select", { value: target, onChange: (event) => {
                  const value = event.target.value;
                  if (value.startsWith("h:")) setDraft({ ...draft, agent: "deepseek-harness", provider: value.slice(2), model: null });
                  else { const model = data.agentModels.find((m) => `a:${m.agent}:${m.model ?? ""}` === value); setDraft({ ...draft, agent: model?.agent ?? "", provider: null, model: model?.model ?? null }); }
                } }, h("option", { value: "" }, t("chooseTarget")), h("optgroup", { label: t("harness") }, data.providers.filter((p) => p.models.length).map((p) => h("option", { key: p.id, value: `h:${p.id}` }, p.name))), h("optgroup", { label: t("cli") }, data.agentModels.filter((m) => m.enabled).map((m) => h("option", { key: m.id, value: `a:${m.agent}:${m.model ?? ""}` }, `${m.agent} / ${m.model ?? "default"}`))))),
                selectedProvider && h("label", { className: "sd-field" }, h("span", null, t("model")), h("select", { value: draft.model ?? "", onChange: (event) => setDraft({ ...draft, model: event.target.value || null }) }, h("option", { value: "" }, t("chooseTarget")), selectedProvider.models.map((m) => h("option", { key: m.id, value: m.id }, m.name || m.id)))),
                h("label", { className: "sd-field" }, h("span", null, t("effort")), h("select", { value: draft.reasoningEffort ?? "", onChange: (event) => setDraft({ ...draft, reasoningEffort: event.target.value || null }) }, ["", "low", "medium", "high", "xhigh"].map((item) => h("option", { key: item, value: item }, item || "Default"))))),
              h("label", { className: "sd-field", style: { marginTop: 13 } }, h("span", null, t("responsibility")), h("textarea", { value: draft.responsibility, maxLength: 500, placeholder: "Implements features and fixes across the repository.", onChange: (event) => setDraft({ ...draft, responsibility: event.target.value }) })), h("p", { className: "sd-help" }, t("responsibilityHelp")),
              h("div", { className: "sd-field" }, h("span", null, t("taskTypes")), h("div", { className: "sd-categories" }, CATEGORY.map((category) => h("label", { className: "sd-category", key: category }, h("input", { type: "checkbox", checked: draft.categories.includes(category), onChange: () => setDraft({ ...draft, categories: draft.categories.includes(category) ? draft.categories.filter((item) => item !== category) : [...draft.categories, category] }) }), category)))),
              h("div", { className: "sd-actions" }, h("button", { className: "sd-button primary", onClick: saveDraft, disabled: busy }, t("saveLane")), h("button", { className: "sd-button", onClick: () => { setDraft(null); setEditing(null); setError(""); } }, t("cancel")))),
          ),
          h("section", { className: "sd-section" }, h("h3", null, t("defaultLane")), h("p", { className: "sd-help" }, t("defaultHelp")), h("select", { value: settings.defaultLane ?? "", onChange: (event) => setSetting("defaultLane", event.target.value || null), "aria-label": t("defaultLane") }, h("option", { value: "" }, t("automatic")), settings.lanes.filter((lane) => lane.enabled).map((lane) => h("option", { value: lane.id, key: lane.id }, lane.name)))),
          h("section", { className: "sd-section" }, h("h3", null, t("limits")), [["concurrentAttempts", "concurrent", "concurrentHelp", 1, 10, 1], ["attemptLimitMinutes", "timeout", "timeoutHelp", 1, 480, 0.5], ["correctionLimit", "corrections", "correctionsHelp", 0, 4, 1]].map(([key, title, help, min, max, step]) => h("label", { className: "sd-number-row", key }, h("span", null, h("strong", null, t(title)), h("p", null, t(help))), h("input", { type: "number", min, max, step, value: settings[key], onChange: (event) => setSetting(key, Number(event.target.value)), "aria-label": t(title) })))),
          error && h("p", { className: "sd-error", role: "alert" }, error), notice && h("p", { className: "sd-success", role: "status" }, notice),
          h("button", { className: "sd-button primary", onClick: () => save(settings), disabled: busy }, t("save")),
        );
      }

      function ModelsFooter() { return h("p", { className: "sd-help", style: { marginTop: 16 } }, "Smart Delegate: ", t("providersHelp")); }
      ctx.slots.inject("settings.general.item", () => ctx.slots.register({ name: "settings.general.item", id: "smart-delegate-language", order: 0.5 }, LanguageSetting));
      ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "smart-delegate-providers", order: 24, label: () => t("providerNav"), locale: NS }, ProvidersSection));
      ctx.slots.inject("settings.section", () => ctx.slots.register({ name: "settings.section", id: "smart-delegate", order: 25, label: () => t("nav"), locale: NS }, SettingsSection));
      ctx.slots.inject("settings.models.footer", () => ctx.slots.register({ name: "settings.models.footer", id: "smart-delegate", order: 90, locale: NS }, ModelsFooter));
    }
    return { inject: ["slots", "locale"], apply };
  },
});
