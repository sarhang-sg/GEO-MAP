import { UI } from "./i18n";
import { categoryValue, districtValue, governorateValue, languageValue, normalize, ownerName, pointKind } from "./geo-format";
import { localizedStaticCategory, localizedStaticName } from "./map-language";
import { debounceAsync } from "./performance";
import type { Language, SearchChoice } from "./types";

export type SearchAdapter = {
  isSearchIndexReady: () => boolean;
  searchFast?: (term: string) => SearchChoice[];
  prepare?: () => void;
  search: (term: string) => Promise<SearchChoice[]>;
  focusSearch: (choice: SearchChoice) => void;
};

type SearchControllerOptions = {
  input: HTMLInputElement;
  clearButton: HTMLButtonElement;
  results: HTMLDivElement;
  getLanguage: () => Language;
  adapter: SearchAdapter;
  onOpenChange?: (open: boolean) => void;
};

type SearchControllerApi = {
  refresh: () => void;
  refreshLanguage: () => void;
  clear: () => void;
  dismiss: () => void;
};

const VISIBLE_RESULT_LIMIT = 15;

/** Owns responsive search input, result rendering and keyboard navigation. */
export function installSearchController(options: SearchControllerOptions): SearchControllerApi {
  const { input, clearButton, results, getLanguage, adapter } = options;
  let searchVersion = 0;
  let visibleChoices: SearchChoice[] = [];
  let selectedChoice: SearchChoice | null = null;
  let activeIndex = -1;
  let renderGeneration = 0;
  let prepareRequested = false;
  const searchCard = input.closest<HTMLElement>(".search-card");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");

  let lastOpenState = false;
  const setSearchOpen = (open: boolean): void => {
    if (open && !prepareRequested) {
      prepareRequested = true;
      window.queueMicrotask(() => options.adapter.prepare?.());
    }
    if (!open) {
      // Invalidate both pending worker results and queued DOM commits. Several
      // map controls stop bubbling their click events, so a result that settled
      // after the user tapped another control could previously reopen the list.
      searchVersion += 1;
      renderGeneration += 1;
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      results.hidden = true;
    }
    if (open === lastOpenState) return;
    lastOpenState = open;
    searchCard?.classList.toggle("is-search-open", open);
    searchCard?.setAttribute("aria-expanded", String(open));
    options.onOpenChange?.(open);
  };
  const syncShellState = (): void => { searchCard?.classList.toggle("has-search-value", Boolean(input.value.trim())); };

  const choiceName = (choice: SearchChoice): string => {
    const language = getLanguage();
    return choice.type === "local"
      ? languageValue(choice.feature.properties, language)
      : choice.type === "owner"
        ? ownerName(choice.place, language)
        : localizedStaticName(choice.item, language);
  };

  const choiceSubline = (choice: SearchChoice): string => {
    const language = getLanguage();
    if (choice.type === "local") {
      return [categoryValue(choice.feature.properties.place, language, UI[language].place), districtValue(choice.feature.properties, language), governorateValue(choice.feature.properties, language)]
        .filter(Boolean).join(" • ") || UI[language].geographic;
    }
    if (choice.type === "owner") return categoryValue(choice.place.category, language, UI[language].place);
    return localizedStaticCategory(choice.item, language, choice.item.k === "street" ? UI[language].street : UI[language].place);
  };

  const resultButtons = (): HTMLButtonElement[] => Array.from(results.querySelectorAll<HTMLButtonElement>(".search-result"));

  const setActiveIndex = (next: number, scroll = true): void => {
    const buttons = resultButtons();
    if (buttons.length === 0) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    activeIndex = Math.max(0, Math.min(next, buttons.length - 1));
    buttons.forEach((button, index) => {
      const active = index === activeIndex;
      button.setAttribute("aria-selected", String(active));
      button.classList.toggle("is-keyboard-active", active);
      button.tabIndex = -1;
    });
    const active = buttons[activeIndex];
    input.setAttribute("aria-activedescendant", active.id);
    if (scroll) window.queueMicrotask(() => active.scrollIntoView({ block: "nearest", inline: "nearest" }));
  };

  const choose = (choice: SearchChoice): void => {
    selectedChoice = choice;
    adapter.focusSearch(choice);
    input.value = choiceName(choice);
    input.blur();
    setSearchOpen(false);
    clearButton.hidden = false;
    syncShellState();
    results.hidden = true;
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
  };

  const makeMessage = (className: string, text: string): HTMLDivElement => {
    const element = document.createElement("div");
    element.className = className;
    element.textContent = text;
    return element;
  };

  const commitRender = (choices: SearchChoice[], term: string): void => {
    if (!lastOpenState) return;
    visibleChoices = choices.slice(0, VISIBLE_RESULT_LIMIT);
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    const language = getLanguage();
    if (!term.trim()) {
      results.hidden = true;
      results.replaceChildren();
      return;
    }
    if (visibleChoices.length === 0) {
      results.replaceChildren(makeMessage("search-empty", UI[language].noResult));
      results.hidden = false;
      return;
    }

    const fragment = document.createDocumentFragment();
    visibleChoices.forEach((choice, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      button.id = `search-result-${searchVersion}-${index}`;
      button.dataset.searchIndex = String(index);
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.tabIndex = -1;

      const kind = choice.type === "local"
        ? pointKind(choice.feature.properties.place)
        : choice.type === "base" && choice.item.k === "street"
          ? "street"
          : "settlement";
      const mark = document.createElement("span");
      mark.className = "search-result__mark";
      mark.dataset.kind = kind;
      const copy = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = choiceName(choice);
      const subline = document.createElement("small");
      subline.textContent = choiceSubline(choice);
      copy.append(name, subline);
      button.append(mark, copy);
      fragment.append(button);
    });
    results.replaceChildren(fragment);
    results.hidden = false;
  };

  const render = (choices: SearchChoice[], term: string): void => {
    const generation = ++renderGeneration;
    // The result set is capped at 15 rows. Commit in one microtask after the
    // search promise settles instead of placing DOM construction inside the
    // map's animation frame callback.
    window.queueMicrotask(() => {
      if (generation === renderGeneration) commitRender(choices, term);
    });
  };

  const renderLoading = (): void => {
    if (!lastOpenState) return;
    visibleChoices = [];
    activeIndex = -1;
    results.replaceChildren(makeMessage("search-empty search-empty--loading", UI[getLanguage()].searchLoading));
    results.hidden = false;
  };

  const renderSearchError = (): void => {
    if (!lastOpenState) return;
    visibleChoices = [];
    activeIndex = -1;
    results.replaceChildren(makeMessage("search-empty search-empty--error", UI[getLanguage()].searchError));
    results.hidden = false;
  };

  const refresh = debounceAsync(async () => {
    const version = ++searchVersion;
    const term = input.value;
    if (normalize(term).length < 2) {
      render([], "");
      return;
    }
    const fastChoices = adapter.searchFast?.(term) ?? [];
    if (fastChoices.length > 0) render(fastChoices, term);
    else if (!adapter.isSearchIndexReady()) renderLoading();
    try {
      const choices = await adapter.search(term);
      if (version !== searchVersion) return;
      render(choices.length > 0 ? choices : fastChoices, term);
    } catch {
      if (version !== searchVersion) return;
      if (fastChoices.length > 0) render(fastChoices, term);
      else renderSearchError();
    }
  }, 135);

  const clear = (): void => {
    searchVersion += 1;
    input.value = "";
    selectedChoice = null;
    activeIndex = -1;
    clearButton.hidden = true;
    input.removeAttribute("aria-activedescendant");
    syncShellState();
    setSearchOpen(false);
    render([], "");
  };

  const dismiss = (): void => {
    setSearchOpen(false);
    if (document.activeElement === input || searchCard?.contains(document.activeElement)) input.blur();
  };

  searchCard?.setAttribute("aria-expanded", "false");
  results.setAttribute("aria-live", "polite");
  results.setAttribute("role", "listbox");
  results.id ||= "searchResults";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("enterkeyhint", "search");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", results.id);

  results.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(".search-result");
    if (!button || !results.contains(button)) return;
    const index = Number.parseInt(button.dataset.searchIndex ?? "-1", 10);
    const choice = visibleChoices[index];
    if (choice) choose(choice);
  });
  results.addEventListener("pointermove", (event) => {
    if (!finePointer.matches) return;
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(".search-result");
    if (!button || !results.contains(button)) return;
    const index = Number.parseInt(button.dataset.searchIndex ?? "-1", 10);
    if (Number.isFinite(index) && index >= 0 && index !== activeIndex) setActiveIndex(index, false);
  }, { passive: true });

  input.addEventListener("input", () => {
    selectedChoice = null;
    activeIndex = -1;
    clearButton.hidden = !input.value;
    syncShellState();
    setSearchOpen(true);
    refresh();
  });
  input.addEventListener("focus", () => {
    setSearchOpen(true);
    refresh();
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!searchCard?.contains(document.activeElement)) setSearchOpen(false);
    }, 0);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clear();
      input.blur();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && visibleChoices.length > 0) {
      event.preventDefault();
      setSearchOpen(true);
      results.hidden = false;
      if (event.key === "Home") setActiveIndex(0);
      else if (event.key === "End") setActiveIndex(visibleChoices.length - 1);
      else if (event.key === "ArrowDown") setActiveIndex(activeIndex < 0 ? 0 : activeIndex + 1);
      else setActiveIndex(activeIndex < 0 ? visibleChoices.length - 1 : activeIndex - 1);
      return;
    }
    if (event.key === "Enter" && visibleChoices.length > 0) {
      event.preventDefault();
      choose(visibleChoices[activeIndex >= 0 ? activeIndex : 0]);
    }
  });
  clearButton.addEventListener("click", () => {
    clear();
    setSearchOpen(true);
    input.focus();
  });
  // Capture pointerdown so MapLibre and custom controls cannot keep a stale
  // result overlay alive by stopping the later click event.
  document.addEventListener("pointerdown", (event) => {
    const target = event.target as Node;
    if (!searchCard?.contains(target)) {
      dismiss();
    }
  }, { capture: true, passive: true });

  const refreshLanguage = (): void => {
    if (selectedChoice) {
      input.value = choiceName(selectedChoice);
      clearButton.hidden = false;
      syncShellState();
    }
    if (lastOpenState && input.value.trim()) {
      render(visibleChoices, input.value);
      refresh();
    }
  };

  syncShellState();
  return { refresh, refreshLanguage, clear, dismiss };
}
