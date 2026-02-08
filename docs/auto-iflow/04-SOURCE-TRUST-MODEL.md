# 🔍 Модель достоверности источников для Planning Module

**Цель:** Обеспечить качество и достоверность данных, получаемых из интернет-поиска в модуле Консилиума.

---

## 🎯 Проблема

Модуль Planning опирается на интернет-поиск для контекстуализации вопросов, но:

1. Не все источники одинаково достоверны
2. Информация может быть устаревшей
3. LLM могут галлюцинировать при интерпретации данных
4. Нет механизма перекрестной проверки

---

## 🏗 Архитектура верификации

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Question   │────►│  Multi-     │────►│  Trust      │
│  Generator  │     │  Source     │     │  Scorer     │
│             │     │  Search     │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Agents     │◄────│  Context    │◄────│  Fact       │
│  Analysis   │     │  Builder    │     │  Checker    │
└─────────────┘     └─────────────┘     └─────────────┘
```

---

## 📊 Trust Score Model

### Компоненты оценки

Каждый источник получает Trust Score от 0.0 до 1.0 на основе:

```python
@dataclass
class TrustFactors:
    domain_reputation: float    # 0.0 - 1.0
    source_recency: float       # 0.0 - 1.0
    citation_count: float       # 0.0 - 1.0
    cross_validation: float     # 0.0 - 1.0

def calculate_trust_score(factors: TrustFactors) -> float:
    weights = {
        "domain_reputation": 0.35,
        "source_recency": 0.20,
        "citation_count": 0.15,
        "cross_validation": 0.30
    }
    
    score = (
        factors.domain_reputation * weights["domain_reputation"] +
        factors.source_recency * weights["source_recency"] +
        factors.citation_count * weights["citation_count"] +
        factors.cross_validation * weights["cross_validation"]
    )
    
    return round(score, 2)
```

### 1. Domain Reputation

| Категория | Примеры | Score |
|-----------|---------|-------|
| **Tier 1** (Первичные) | Официальная документация, научные журналы, gov/edu | 0.95 - 1.0 |
| **Tier 2** (Авторитетные) | Gartner, McKinsey, TechCrunch, HBR | 0.80 - 0.94 |
| **Tier 3** (Качественные) | Medium (verified), Dev.to, индустриальные блоги | 0.60 - 0.79 |
| **Tier 4** (Пользовательские) | Reddit, StackOverflow, форумы | 0.40 - 0.59 |
| **Tier 5** (Непроверенные) | Личные блоги, социальные сети | 0.20 - 0.39 |
| **Blacklisted** | SEO-спам, фейковые новости | 0.0 |

```python
DOMAIN_REPUTATION_DB = {
    # Tier 1
    ".gov": 0.95,
    ".edu": 0.95,
    "docs.python.org": 1.0,
    "developer.mozilla.org": 0.98,
    "arxiv.org": 0.95,
    
    # Tier 2
    "gartner.com": 0.90,
    "mckinsey.com": 0.88,
    "techcrunch.com": 0.82,
    "hbr.org": 0.85,
    
    # Tier 3
    "medium.com": 0.65,  # Зависит от автора
    "dev.to": 0.60,
    "hashnode.com": 0.58,
    
    # Tier 4
    "reddit.com": 0.50,
    "stackoverflow.com": 0.55,
    "quora.com": 0.45,
    
    # Default
    "_default": 0.40
}
```

### 2. Source Recency

```python
def calculate_recency_score(published_date: datetime) -> float:
    """Более свежие источники получают более высокий балл"""
    age_days = (datetime.utcnow() - published_date).days
    
    if age_days <= 30:
        return 1.0
    elif age_days <= 90:
        return 0.9
    elif age_days <= 180:
        return 0.8
    elif age_days <= 365:
        return 0.6
    elif age_days <= 730:  # 2 years
        return 0.4
    else:
        return 0.2
```

### 3. Citation Count

```python
def calculate_citation_score(citation_count: int, domain_type: str) -> float:
    """Нормализованный балл на основе цитирований"""
    
    # Разные thresholds для разных типов контента
    thresholds = {
        "academic": {"high": 100, "medium": 20},
        "blog": {"high": 1000, "medium": 100},
        "forum": {"high": 500, "medium": 50}
    }
    
    t = thresholds.get(domain_type, thresholds["blog"])
    
    if citation_count >= t["high"]:
        return 1.0
    elif citation_count >= t["medium"]:
        return 0.7
    elif citation_count > 0:
        return 0.4
    else:
        return 0.2
```

### 4. Cross-Validation Score

```python
async def calculate_cross_validation_score(
    claim: str,
    sources: List[SearchResult]
) -> float:
    """Проверяет, подтверждается ли claim несколькими источниками"""
    
    confirming_sources = 0
    contradicting_sources = 0
    
    for source in sources:
        # Используем LLM для проверки согласованности
        result = await verify_claim_against_source(claim, source)
        
        if result == "confirms":
            confirming_sources += 1
        elif result == "contradicts":
            contradicting_sources += 1
    
    if contradicting_sources >= 2:
        return 0.0  # Явное противоречие
    
    # Требуем минимум 2 подтверждающих источника
    if confirming_sources >= 3:
        return 1.0
    elif confirming_sources >= 2:
        return 0.8
    elif confirming_sources >= 1:
        return 0.5
    else:
        return 0.3  # Единственный источник
```

---

## 🔄 Политика поиска

### Минимум 2 независимых источника

```python
@dataclass
class SearchPolicy:
    min_sources: int = 2
    max_sources: int = 5
    min_trust_score: float = 0.5
    require_tier1_or_tier2: bool = True
    max_same_domain_sources: int = 2
    
async def search_with_policy(
    query: str,
    policy: SearchPolicy
) -> List[VerifiedSource]:
    """Поиск с соблюдением политики достоверности"""
    
    # Шаг 1: Получаем кандидатов из нескольких поисковых систем
    candidates = []
    
    async with asyncio.TaskGroup() as tg:
        # Perplexity API
        perplexity_task = tg.create_task(search_perplexity(query))
        # Tavily API (fallback)
        tavily_task = tg.create_task(search_tavily(query))
    
    candidates.extend(perplexity_task.result())
    candidates.extend(tavily_task.result())
    
    # Шаг 2: Дедупликация по URL
    unique_candidates = deduplicate_by_url(candidates)
    
    # Шаг 3: Оценка Trust Score
    scored_candidates = []
    for candidate in unique_candidates:
        trust_score = await calculate_full_trust_score(candidate)
        if trust_score >= policy.min_trust_score:
            scored_candidates.append((candidate, trust_score))
    
    # Шаг 4: Сортировка по Trust Score
    scored_candidates.sort(key=lambda x: x[1], reverse=True)
    
    # Шаг 5: Выбор с соблюдением diversity
    selected = []
    domain_counts = defaultdict(int)
    has_tier1_or_tier2 = False
    
    for candidate, score in scored_candidates:
        domain = get_base_domain(candidate.url)
        
        # Проверяем лимит на домен
        if domain_counts[domain] >= policy.max_same_domain_sources:
            continue
        
        selected.append(VerifiedSource(
            source=candidate,
            trust_score=score,
            verification_tag=get_verification_tag(score)
        ))
        domain_counts[domain] += 1
        
        if score >= 0.8:
            has_tier1_or_tier2 = True
        
        if len(selected) >= policy.max_sources:
            break
    
    # Шаг 6: Валидация политики
    if len(selected) < policy.min_sources:
        raise InsufficientSourcesError(
            f"Found only {len(selected)} sources, need {policy.min_sources}"
        )
    
    if policy.require_tier1_or_tier2 and not has_tier1_or_tier2:
        raise NoAuthoritySourceError(
            "No Tier 1 or Tier 2 sources found"
        )
    
    return selected
```

---

## 🏷 Verification Tags

Каждый источник получает визуальный тег для UI:

| Tag | Trust Score | Emoji | Значение |
|-----|-------------|-------|----------|
| `VERIFIED` | ≥ 0.85 | ✅ | Высокодостоверный источник |
| `TRUSTED` | 0.70 - 0.84 | 🟢 | Доверенный источник |
| `MODERATE` | 0.50 - 0.69 | 🟡 | Умеренная достоверность |
| `LOW` | 0.30 - 0.49 | 🟠 | Низкая достоверность |
| `UNVERIFIED` | < 0.30 | 🔴 | Непроверенный источник |

```python
def get_verification_tag(trust_score: float) -> VerificationTag:
    if trust_score >= 0.85:
        return VerificationTag.VERIFIED
    elif trust_score >= 0.70:
        return VerificationTag.TRUSTED
    elif trust_score >= 0.50:
        return VerificationTag.MODERATE
    elif trust_score >= 0.30:
        return VerificationTag.LOW
    else:
        return VerificationTag.UNVERIFIED
```

---

## 🛡 Анти-галлюцинационные меры

### 1. Explicit Grounding

```python
GROUNDING_PROMPT = """
You are analyzing information from external sources. Follow these rules:

1. ONLY use information that is EXPLICITLY stated in the provided sources
2. DO NOT infer or extrapolate beyond what sources say
3. If sources disagree, note the contradiction explicitly
4. If no source covers a topic, say "No data available from sources"
5. Always cite the specific source for each claim using [Source N] format

Sources:
{sources}

Question: {question}

Provide your analysis, citing sources for every factual claim.
"""
```

### 2. Confidence Calibration

```python
@dataclass
class AnalysisResult:
    content: str
    confidence: float  # 0.0 - 1.0
    source_coverage: float  # % вопроса покрытого источниками
    contradictions: List[str]

async def analyze_with_confidence(
    question: str,
    sources: List[VerifiedSource],
    agent_role: str
) -> AnalysisResult:
    
    # Генерация анализа с explicit grounding
    response = await llm.generate(
        GROUNDING_PROMPT.format(
            sources=format_sources(sources),
            question=question
        ),
        system_prompt=AGENT_PROMPTS[agent_role]
    )
    
    # Оценка покрытия источниками
    source_coverage = calculate_source_coverage(question, sources, response)
    
    # Поиск противоречий
    contradictions = detect_contradictions(sources)
    
    # Расчет confidence
    avg_trust = sum(s.trust_score for s in sources) / len(sources)
    confidence = avg_trust * source_coverage * (1 - 0.2 * len(contradictions))
    
    return AnalysisResult(
        content=response,
        confidence=confidence,
        source_coverage=source_coverage,
        contradictions=contradictions
    )
```

### 3. Fact Extraction & Verification

```python
async def extract_and_verify_facts(
    analysis: str,
    sources: List[VerifiedSource]
) -> List[VerifiedFact]:
    """Извлекает факты из анализа и проверяет их против источников"""
    
    # Извлекаем факты
    facts = await extract_facts(analysis)
    
    verified_facts = []
    for fact in facts:
        # Проверяем каждый факт
        verification = await verify_fact_against_sources(fact, sources)
        
        verified_facts.append(VerifiedFact(
            statement=fact.statement,
            source_references=verification.sources,
            verified=verification.is_verified,
            confidence=verification.confidence,
            contradicting_sources=verification.contradictions
        ))
    
    return verified_facts
```

### 4. Contradiction Detection

```python
async def detect_contradictions(
    sources: List[VerifiedSource]
) -> List[Contradiction]:
    """Находит противоречия между источниками"""
    
    contradictions = []
    
    for i, source_a in enumerate(sources):
        for source_b in sources[i+1:]:
            # Сравниваем каждую пару
            result = await compare_sources_for_contradictions(source_a, source_b)
            
            if result.has_contradiction:
                contradictions.append(Contradiction(
                    source_a=source_a.url,
                    source_b=source_b.url,
                    claim_a=result.claim_a,
                    claim_b=result.claim_b,
                    topic=result.topic
                ))
    
    return contradictions
```

---

## 📊 UI Presentation

### Source Card Format

```markdown
### 📰 Market Size Analysis

**Source 1:** [Gartner Report 2025](https://gartner.com/...) ✅ VERIFIED
> "The global AI market is projected to reach $407B by 2027..."
- Trust Score: 0.92
- Published: Jan 2025
- Cross-validated: 3 other sources

**Source 2:** [TechCrunch Analysis](https://techcrunch.com/...) 🟢 TRUSTED
> "AI startup funding increased 15% YoY..."
- Trust Score: 0.78
- Published: Dec 2025
- Cross-validated: 2 other sources

⚠️ **Note:** Sources disagree on growth rate (Gartner: 25%, TechCrunch: 15%)
```

### Confidence Indicator

```markdown
## Analysis Confidence

| Metric | Value |
|--------|-------|
| Overall confidence | 🟢 82% |
| Source coverage | 95% |
| Contradictions | 1 minor |
| Verification tags | 2 ✅, 1 🟢, 0 🟡 |
```

---

## ✅ Checklist для каждого поискового запроса

- [ ] Минимум 2 независимых источника
- [ ] Есть хотя бы 1 источник Tier 1-2
- [ ] Нет более 2 источников с одного домена
- [ ] Все источники имеют trust score ≥ 0.5
- [ ] Противоречия задокументированы
- [ ] Каждый факт привязан к источнику
- [ ] Confidence score рассчитан и отображен
