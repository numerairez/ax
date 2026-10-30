"""Synthetic datasets designed to exercise as many chart types as possible.

Every generator is seeded so the data is stable across restarts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _rng(seed: int) -> np.random.Generator:
    return np.random.default_rng(seed)


# ---------------------------------------------------------------------------
# Retail sales: time, geo, nested categories, many measures
# ---------------------------------------------------------------------------

CITIES = [
    ("New York", "NY", 40.71, -74.01, "East"),
    ("Boston", "MA", 42.36, -71.06, "East"),
    ("Philadelphia", "PA", 39.95, -75.17, "East"),
    ("Pittsburgh", "PA", 40.44, -79.99, "East"),
    ("Miami", "FL", 25.76, -80.19, "South"),
    ("Atlanta", "GA", 33.75, -84.39, "South"),
    ("Houston", "TX", 29.76, -95.37, "South"),
    ("Dallas", "TX", 32.78, -96.80, "South"),
    ("Nashville", "TN", 36.16, -86.78, "South"),
    ("Charlotte", "NC", 35.23, -80.84, "South"),
    ("Chicago", "IL", 41.88, -87.63, "Central"),
    ("Minneapolis", "MN", 44.98, -93.27, "Central"),
    ("Denver", "CO", 39.74, -104.99, "Central"),
    ("St. Louis", "MO", 38.63, -90.20, "Central"),
    ("Detroit", "MI", 42.33, -83.05, "Central"),
    ("Seattle", "WA", 47.61, -122.33, "West"),
    ("San Francisco", "CA", 37.77, -122.42, "West"),
    ("Los Angeles", "CA", 34.05, -118.24, "West"),
    ("Phoenix", "AZ", 33.45, -112.07, "West"),
    ("Portland", "OR", 45.52, -122.68, "West"),
    ("Salt Lake City", "UT", 40.76, -111.89, "West"),
]

CATEGORIES = {
    "Electronics": (0.12, {"Phones": (300, 1100), "Laptops": (600, 2200), "Audio": (30, 350), "Accessories": (10, 80)}),
    "Furniture": (0.18, {"Chairs": (80, 450), "Tables": (150, 900), "Storage": (60, 400), "Decor": (15, 120)}),
    "Office": (0.35, {"Paper": (5, 30), "Binders": (3, 25), "Art Supplies": (4, 40), "Labels": (2, 15)}),
    "Apparel": (0.40, {"Outerwear": (60, 300), "Footwear": (40, 200), "Activewear": (20, 90), "Basics": (8, 40)}),
    "Grocery": (0.22, {"Snacks": (2, 10), "Beverages": (3, 15), "Pantry": (3, 20), "Fresh": (2, 12)}),
}


def retail_sales(n: int = 4000) -> pd.DataFrame:
    rng = _rng(1)
    days = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    t = np.arange(len(days))
    month = days.month.to_numpy()
    weekday = days.weekday.to_numpy()
    weight = (1 + t / len(days) * 0.6)  # growth trend
    weight *= np.where(np.isin(month, [11, 12]), 1.8, 1.0)  # holiday season
    weight *= np.where(np.isin(month, [7, 8]), 1.2, 1.0)  # summer
    weight *= np.where(weekday >= 5, 1.35, 1.0)  # weekends
    weight /= weight.sum()
    day_idx = rng.choice(len(days), size=n, p=weight)
    hours = np.clip(rng.normal(14, 3.5, n), 8, 21).astype(int)
    minutes = rng.integers(0, 60, n)
    order_dates = days[day_idx] + pd.to_timedelta(hours, "h") + pd.to_timedelta(minutes, "m")

    city_idx = rng.choice(len(CITIES), size=n, p=_normalized(rng.uniform(0.5, 2.0, len(CITIES))))
    cat_names = list(CATEGORIES)
    cats = rng.choice(cat_names, size=n, p=[0.24, 0.16, 0.2, 0.22, 0.18])

    rows = []
    for i in range(n):
        city, state, lat, lon, region = CITIES[city_idx[i]]
        cat = cats[i]
        margin, subs = CATEGORIES[cat]
        sub = rng.choice(list(subs))
        lo, hi = subs[sub]
        unit_price = round(float(np.exp(rng.uniform(np.log(lo), np.log(hi)))), 2)
        units = int(rng.poisson(6 if cat == "Grocery" else 1.6) + 1)
        channel = rng.choice(["Online", "Store", "Partner"], p=[0.45, 0.4, 0.15])
        segment = rng.choice(["Consumer", "Corporate", "Home Office"], p=[0.55, 0.3, 0.15])
        discount = float(rng.choice([0, 0.05, 0.1, 0.15, 0.2, 0.3], p=[0.4, 0.15, 0.2, 0.1, 0.1, 0.05]))
        revenue = round(unit_price * units * (1 - discount), 2)
        profit = round(revenue * (margin - discount * 1.2) + rng.normal(0, revenue * 0.05), 2)
        rating = int(np.clip(round(rng.normal(4.1 - discount * 2 + (0.3 if channel == "Store" else 0), 0.8)), 1, 5))
        delivery = int(rng.gamma(2.0, 1.6) + 1) if channel != "Store" else 0
        rows.append(
            {
                "order_id": f"ORD-{100000 + i}",
                "order_date": order_dates[i],
                "region": region,
                "state": state,
                "city": city,
                "latitude": lat,
                "longitude": lon,
                "category": cat,
                "sub_category": sub,
                "channel": channel,
                "segment": segment,
                "units": units,
                "unit_price": unit_price,
                "discount": discount,
                "revenue": revenue,
                "profit": profit,
                "rating": rating,
                "delivery_days": delivery,
            }
        )
    return pd.DataFrame(rows).sort_values("order_date").reset_index(drop=True)


# ---------------------------------------------------------------------------
# Weather: daily seasonal series for cities with distinct climates
# ---------------------------------------------------------------------------

CLIMATES = {
    # city: (mean max °C, seasonal amplitude, diurnal range, rain prob, humidity)
    "Seattle": (15, 8, 7, 0.45, 78),
    "New York": (17, 12, 8, 0.3, 64),
    "Chicago": (15, 15, 9, 0.3, 68),
    "Phoenix": (30, 10, 14, 0.06, 30),
    "Miami": (29, 3.5, 7, 0.38, 75),
    "Denver": (18, 12, 15, 0.18, 45),
}


def weather() -> pd.DataFrame:
    rng = _rng(2)
    days = pd.date_range("2023-01-01", "2025-12-31", freq="D")
    doy = days.dayofyear.to_numpy()
    season = -np.cos(2 * np.pi * (doy - 15) / 365.25)  # -1 mid-Jan, +1 mid-July
    frames = []
    for city, (mean, amp, diurnal, rain_p, hum) in CLIMATES.items():
        n = len(days)
        noise = np.convolve(rng.normal(0, 2.8, n + 6), np.ones(7) / 7 * 2.2, mode="valid")[:n]
        tmax = mean + amp * season + noise + rng.normal(0, 1.2, n)
        tmin = tmax - diurnal - rng.normal(0, 1.5, n)
        p_rain = np.clip(rain_p * (1.25 - 0.5 * season if city in ("Seattle", "Phoenix") else 1 + 0.3 * season), 0.01, 0.95)
        rainy = rng.random(n) < p_rain
        precip = np.where(rainy, rng.gamma(0.9, 6.5, n), 0.0)
        wind = np.clip(rng.gamma(4, 3.2, n) + (4 if city == "Chicago" else 0), 0, None)
        humidity = np.clip(hum + 12 * rainy + rng.normal(0, 7, n), 8, 100)
        cond = np.where(
            rainy & (tmax < 1.5), "snow",
            np.where(rainy & (precip > 3), "rain", np.where(rainy, "drizzle", np.where(rng.random(n) < 0.06, "fog", "sun"))),
        )
        frames.append(
            pd.DataFrame(
                {
                    "date": days,
                    "city": city,
                    "temp_max": tmax.round(1),
                    "temp_min": tmin.round(1),
                    "precipitation": precip.round(1),
                    "wind_kmh": wind.round(1),
                    "humidity": humidity.round(0),
                    "condition": cond,
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Stocks: correlated OHLC series for fictional tickers
# ---------------------------------------------------------------------------

TICKERS = {
    # symbol: (sector, start price, annual drift, annual vol, market beta)
    "NOVA": ("Technology", 120, 0.22, 0.38, 1.3),
    "KITE": ("Technology", 45, 0.10, 0.5, 1.6),
    "ORBX": ("Energy", 70, 0.04, 0.3, 0.8),
    "PLMR": ("Healthcare", 210, 0.08, 0.2, 0.6),
    "ZEPH": ("Consumer", 32, 0.15, 0.33, 1.0),
    "QNTM": ("Finance", 88, 0.06, 0.24, 1.1),
}


def stocks() -> pd.DataFrame:
    rng = _rng(3)
    days = pd.bdate_range("2022-01-03", "2025-12-31")
    n = len(days)
    dt = 1 / 252
    market = rng.normal(0.0002, 0.011, n)
    market[300:340] -= 0.006  # a drawdown everybody shares
    frames = []
    for sym, (sector, p0, mu, sigma, beta) in TICKERS.items():
        idio = rng.normal(0, sigma * np.sqrt(dt), n)
        ret = mu * dt + beta * market + idio
        close = p0 * np.exp(np.cumsum(ret))
        prev = np.concatenate([[p0], close[:-1]])
        open_ = prev * (1 + rng.normal(0, 0.004, n))
        high = np.maximum(open_, close) * (1 + np.abs(rng.normal(0, 0.008, n)))
        low = np.minimum(open_, close) * (1 - np.abs(rng.normal(0, 0.008, n)))
        volume = (rng.lognormal(14, 0.35, n) * (1 + 30 * np.abs(ret))).astype(int)
        frames.append(
            pd.DataFrame(
                {
                    "date": days,
                    "symbol": sym,
                    "sector": sector,
                    "open": open_.round(2),
                    "high": high.round(2),
                    "low": low.round(2),
                    "close": close.round(2),
                    "volume": volume,
                    "daily_return": (ret * 100).round(3),
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Countries: Gapminder-style panel. Real countries & ISO codes, synthetic values.
# ---------------------------------------------------------------------------

# name, iso3, iso numeric, continent, lat, lon, pop 1990 (M), pop growth, gdp 1990, gdp growth, life exp 1990, co2 1990
COUNTRIES = [
    ("United States", "USA", 840, "Americas", 39.8, -98.6, 250, 0.008, 36000, 0.016, 75.2, 19.5),
    ("Canada", "CAN", 124, "Americas", 56.1, -106.3, 27.7, 0.010, 30000, 0.014, 77.4, 16.0),
    ("Mexico", "MEX", 484, "Americas", 23.6, -102.5, 84, 0.013, 12000, 0.012, 70.8, 3.7),
    ("Brazil", "BRA", 76, "Americas", -14.2, -51.9, 150, 0.011, 9800, 0.012, 66.3, 1.4),
    ("Argentina", "ARG", 32, "Americas", -38.4, -63.6, 32.6, 0.010, 13000, 0.010, 71.6, 3.4),
    ("Colombia", "COL", 170, "Americas", 4.6, -74.3, 34.9, 0.013, 8000, 0.020, 68.3, 1.6),
    ("Chile", "CHL", 152, "Americas", -35.7, -71.5, 13.2, 0.011, 9000, 0.032, 73.6, 2.6),
    ("Peru", "PER", 604, "Americas", -9.2, -75.0, 22, 0.013, 5000, 0.030, 66.0, 1.0),
    ("United Kingdom", "GBR", 826, "Europe", 55.4, -3.4, 57.2, 0.005, 30000, 0.014, 75.9, 10.0),
    ("France", "FRA", 250, "Europe", 46.2, 2.2, 58, 0.004, 31000, 0.012, 76.9, 6.8),
    ("Germany", "DEU", 276, "Europe", 51.2, 10.5, 79.4, 0.001, 33000, 0.013, 75.3, 12.0),
    ("Italy", "ITA", 380, "Europe", 41.9, 12.6, 56.7, 0.001, 32000, 0.005, 77.1, 7.5),
    ("Spain", "ESP", 724, "Europe", 40.5, -3.7, 38.8, 0.005, 25000, 0.013, 76.8, 5.7),
    ("Netherlands", "NLD", 528, "Europe", 52.1, 5.3, 15, 0.005, 33000, 0.015, 77.0, 10.8),
    ("Sweden", "SWE", 752, "Europe", 60.1, 18.6, 8.6, 0.006, 32000, 0.017, 77.6, 6.1),
    ("Norway", "NOR", 578, "Europe", 60.5, 8.5, 4.2, 0.008, 45000, 0.015, 76.6, 8.3),
    ("Poland", "POL", 616, "Europe", 51.9, 19.1, 38.1, -0.001, 9000, 0.038, 70.9, 9.5),
    ("Ukraine", "UKR", 804, "Europe", 48.4, 31.2, 51.9, -0.007, 9000, 0.004, 70.1, 13.0),
    ("Russia", "RUS", 643, "Europe", 61.5, 105.3, 148, -0.001, 18000, 0.011, 68.9, 15.0),
    ("Turkey", "TUR", 792, "Asia", 38.9, 35.2, 54, 0.014, 11000, 0.030, 64.3, 2.6),
    ("China", "CHN", 156, "Asia", 35.9, 104.2, 1135, 0.006, 1500, 0.085, 69.1, 2.1),
    ("Japan", "JPN", 392, "Asia", 36.2, 138.3, 123.5, 0.000, 34000, 0.008, 78.8, 8.9),
    ("South Korea", "KOR", 410, "Asia", 35.9, 127.8, 42.9, 0.005, 12000, 0.042, 71.7, 5.8),
    ("India", "IND", 356, "Asia", 20.6, 79.0, 870, 0.015, 1700, 0.055, 57.9, 0.7),
    ("Indonesia", "IDN", 360, "Asia", -0.8, 113.9, 181, 0.013, 4000, 0.040, 63.3, 0.8),
    ("Philippines", "PHL", 608, "Asia", 12.9, 121.8, 61.9, 0.018, 3800, 0.035, 65.3, 0.7),
    ("Vietnam", "VNM", 704, "Asia", 14.1, 108.3, 68, 0.012, 1800, 0.060, 70.5, 0.3),
    ("Thailand", "THA", 764, "Asia", 15.9, 101.0, 56.6, 0.006, 6500, 0.035, 70.3, 1.6),
    ("Malaysia", "MYS", 458, "Asia", 4.2, 101.98, 18.2, 0.017, 10000, 0.038, 70.8, 3.1),
    ("Pakistan", "PAK", 586, "Asia", 30.4, 69.3, 115, 0.022, 2900, 0.020, 60.1, 0.6),
    ("Bangladesh", "BGD", 50, "Asia", 23.7, 90.4, 107, 0.015, 1400, 0.050, 58.2, 0.15),
    ("Saudi Arabia", "SAU", 682, "Asia", 23.9, 45.1, 16.3, 0.025, 35000, 0.008, 68.9, 13.0),
    ("Iran", "IRN", 364, "Asia", 32.4, 53.7, 56.4, 0.013, 9000, 0.020, 64.0, 4.0),
    ("Australia", "AUS", 36, "Oceania", -25.3, 133.8, 17, 0.013, 30000, 0.017, 77.0, 16.5),
    ("New Zealand", "NZL", 554, "Oceania", -40.9, 174.9, 3.4, 0.012, 24000, 0.016, 75.4, 7.2),
    ("South Africa", "ZAF", 710, "Africa", -30.6, 22.9, 39, 0.014, 10000, 0.008, 63.0, 8.8),
    ("Nigeria", "NGA", 566, "Africa", 9.1, 8.7, 95, 0.026, 2500, 0.025, 45.9, 0.5),
    ("Egypt", "EGY", 818, "Africa", 26.8, 30.8, 57, 0.019, 6000, 0.030, 64.6, 1.6),
    ("Kenya", "KEN", 404, "Africa", -0.02, 37.9, 23.4, 0.027, 2500, 0.020, 57.1, 0.25),
    ("Ethiopia", "ETH", 231, "Africa", 9.1, 40.5, 48, 0.028, 700, 0.055, 47.0, 0.05),
    ("Ghana", "GHA", 288, "Africa", 7.9, -1.0, 14.8, 0.024, 2500, 0.040, 56.8, 0.25),
    ("Morocco", "MAR", 504, "Africa", 31.8, -7.1, 24.8, 0.012, 4500, 0.028, 64.7, 1.0),
]


def countries() -> pd.DataFrame:
    rng = _rng(4)
    rows = []
    years = np.arange(1990, 2026)
    for (name, iso3, iso, cont, lat, lon, pop0, pg, gdp0, gg, le0, co20) in COUNTRIES:
        shocks = rng.normal(0, 0.02, len(years))
        shocks[years == 2009] -= 0.04  # financial crisis
        shocks[years == 2020] -= 0.06  # pandemic
        gdp = gdp0 * np.exp(np.cumsum(gg + shocks))
        pop = pop0 * np.exp(np.cumsum(np.full(len(years), pg) + rng.normal(0, 0.002, len(years))))
        le_gain = (82.5 - le0) * (1 - np.exp(-(years - 1990) / 55))
        le = le0 + le_gain + rng.normal(0, 0.25, len(years))
        le[years == 2020] -= rng.uniform(0.5, 2.0)
        co2 = co20 * (gdp / gdp0) ** 0.45 * np.exp(-0.012 * (years - 1990) * (gdp0 > 20000))
        fert = np.clip(1.4 + (7000 / (gdp + 2000)) * 1.6 + rng.normal(0, 0.05, len(years)), 1.0, 7.5)
        internet = 100 / (1 + np.exp(-(years - (2004 + 9 * np.exp(-gdp0 / 15000))) / 3.2))
        for j, y in enumerate(years):
            rows.append(
                {
                    "country": name,
                    "iso3": iso3,
                    "iso_numeric": iso,
                    "continent": cont,
                    "year": int(y),
                    "latitude": lat,
                    "longitude": lon,
                    "population_m": round(float(pop[j]), 2),
                    "gdp_per_capita": round(float(gdp[j]), 0),
                    "life_expectancy": round(float(le[j]), 1),
                    "co2_per_capita": round(float(co2[j]), 2),
                    "fertility_rate": round(float(fert[j]), 2),
                    "internet_pct": round(float(internet[j]), 1),
                }
            )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# Botanical specimens: clustered multivariate measurements (SPLOM, PCA-ish)
# ---------------------------------------------------------------------------

SPECIES = {
    # species: means of (petal_len, petal_wid, sepal_len, sepal_wid, stem_height), scale
    "Aurelia": ((1.5, 0.3, 5.0, 3.4, 22), 1.0),
    "Borealis": ((4.3, 1.3, 5.9, 2.8, 41), 1.3),
    "Cindera": ((5.6, 2.0, 6.6, 3.0, 58), 1.5),
    "Dusklily": ((3.2, 0.9, 4.6, 2.3, 30), 1.1),
}


def specimens() -> pd.DataFrame:
    rng = _rng(5)
    corr = np.array(
        [
            [1.0, 0.8, 0.6, 0.1, 0.5],
            [0.8, 1.0, 0.5, 0.1, 0.4],
            [0.6, 0.5, 1.0, 0.4, 0.5],
            [0.1, 0.1, 0.4, 1.0, 0.1],
            [0.5, 0.4, 0.5, 0.1, 1.0],
        ]
    )
    sds = np.array([0.35, 0.18, 0.4, 0.3, 6])
    frames = []
    sites = ["North Ridge", "Fern Valley", "Salt Marsh"]
    for sp, (means, scale) in SPECIES.items():
        n = int(rng.integers(90, 140))
        cov = np.outer(sds * scale, sds * scale) * corr
        x = rng.multivariate_normal(means, cov, n)
        site = rng.choice(sites, n, p=_normalized(rng.uniform(0.5, 2, 3)))
        bloom = pd.Timestamp("2025-03-01") + pd.to_timedelta(rng.normal(60 + 15 * list(SPECIES).index(sp), 12, n).astype(int), "D")
        frames.append(
            pd.DataFrame(
                {
                    "specimen_id": [f"{sp[:3].upper()}-{k:03d}" for k in range(n)],
                    "species": sp,
                    "site": site,
                    "observed_on": bloom,
                    "petal_length": np.clip(x[:, 0], 0.2, None).round(2),
                    "petal_width": np.clip(x[:, 1], 0.05, None).round(2),
                    "sepal_length": np.clip(x[:, 2], 1, None).round(2),
                    "sepal_width": np.clip(x[:, 3], 1, None).round(2),
                    "stem_height_cm": np.clip(x[:, 4], 5, None).round(1),
                    "leaf_count": np.clip(rng.poisson(6 + x[:, 4] / 8), 2, None),
                    "pollinator_visits": rng.poisson(np.clip(x[:, 0] * 2.2, 0.5, None)),
                }
            )
        )
    return pd.concat(frames, ignore_index=True)


# ---------------------------------------------------------------------------
# Collaboration network: edges between people in teams (force graph, arcs)
# ---------------------------------------------------------------------------

TEAMS = {
    "Platform": ["Ada", "Linus", "Grace", "Ken", "Barbara", "Dennis", "Radia"],
    "Design": ["Dieter", "Paula", "Susan", "Massimo", "Jony", "Zaha"],
    "Data": ["Florence", "John", "Hadley", "Wes", "Edward", "Hans", "Mona"],
    "Growth": ["Seth", "Avinash", "Ann", "Ryan", "Nir"],
    "Research": ["Claude", "Alan", "Marie", "Rosalind", "Richard", "Emmy", "Kurt"],
}


def network() -> pd.DataFrame:
    rng = _rng(6)
    people = [(p, t) for t, ps in TEAMS.items() for p in ps]
    team_of = dict(people)
    rows = []
    for i, (a, ta) in enumerate(people):
        for b, tb in people[i + 1 :]:
            p = 0.55 if ta == tb else 0.05
            if {ta, tb} in ({"Data", "Research"}, {"Design", "Growth"}, {"Platform", "Data"}):
                p = 0.16
            if rng.random() < p:
                rows.append(
                    {
                        "source": a,
                        "target": b,
                        "source_team": ta,
                        "target_team": team_of[b],
                        "messages": int(rng.gamma(2, 25 if ta == tb else 10)) + 1,
                        "projects_together": int(rng.integers(1, 6)),
                        "cross_team": "yes" if ta != tb else "no",
                    }
                )
    return pd.DataFrame(rows)


# ---------------------------------------------------------------------------
# IPV variance: month-end independent price verification (desk vs IPV)
# ---------------------------------------------------------------------------

# product: (fair value level, IPV sources with weights, typical |variance| in bps, tolerance in bps, exposure scale $m)
PRODUCTS = {
    "IRS": ("L2", {"Consensus": 0.8, "Vendor feed": 0.2}, 0.6, 2, 400),
    "Cross-currency Swap": ("L2", {"Consensus": 0.7, "Broker quote": 0.3}, 1.5, 4, 250),
    "Govt Bond": ("L1", {"Exchange": 0.6, "Vendor feed": 0.4}, 0.4, 1.5, 600),
    "Swaption": ("L2", {"Consensus": 0.9, "Broker quote": 0.1}, 3, 8, 120),
    "Cap/Floor": ("L2", {"Consensus": 0.8, "Broker quote": 0.2}, 4, 10, 80),
    "Bermudan Swaption": ("L3", {"Model proxy": 0.8, "Consensus": 0.2}, 14, 30, 40),
    "EM Swap": ("L2", {"Broker quote": 0.7, "Consensus": 0.3}, 7, 15, 90),
    "EM Bond": ("L2", {"Broker quote": 0.6, "Vendor feed": 0.4}, 9, 20, 110),
    "IG Corporate Bond": ("L2", {"Vendor feed": 0.7, "Broker quote": 0.3}, 5, 12, 300),
    "CDS Index": ("L2", {"Consensus": 0.9, "Vendor feed": 0.1}, 1, 4, 350),
    "Single-name CDS": ("L2", {"Consensus": 0.6, "Broker quote": 0.4}, 3, 9, 150),
    "HY Bond": ("L2", {"Broker quote": 0.7, "Vendor feed": 0.3}, 18, 40, 140),
    "Distressed Loan": ("L3", {"Broker quote": 0.8, "Model proxy": 0.2}, 55, 100, 45),
    "CLO Tranche": ("L3", {"Broker quote": 0.6, "Model proxy": 0.4}, 35, 75, 70),
    "ABS": ("L3", {"Model proxy": 0.6, "Broker quote": 0.4}, 30, 70, 60),
    "FX Forward": ("L2", {"Vendor feed": 0.9, "Consensus": 0.1}, 0.2, 1, 800),
    "FX Vanilla Option": ("L2", {"Consensus": 0.9, "Broker quote": 0.1}, 2, 6, 150),
    "FX Barrier Option": ("L3", {"Model proxy": 0.7, "Consensus": 0.3}, 12, 30, 35),
    "Power Forward": ("L2", {"Broker quote": 0.8, "Exchange": 0.2}, 22, 45, 220),
    "Gas Swap": ("L2", {"Broker quote": 0.6, "Exchange": 0.4}, 14, 35, 80),
    "Metals Forward": ("L1", {"Exchange": 0.9, "Vendor feed": 0.1}, 1, 4, 120),
    "Index Option": ("L1", {"Exchange": 0.9, "Consensus": 0.1}, 1, 4, 200),
    "Variance Swap": ("L2", {"Consensus": 0.9, "Broker quote": 0.1}, 8, 20, 60),
    "Autocallable": ("L3", {"Model proxy": 0.8, "Consensus": 0.2}, 28, 60, 50),
    "Cliquet": ("L3", {"Model proxy": 0.9, "Consensus": 0.1}, 24, 55, 25),
    "Equity Swap": ("L2", {"Vendor feed": 0.8, "Exchange": 0.2}, 1, 4, 300),
}

# (division, business line, desk, region, number of books, products)
DESKS = [
    ("FICC", "Rates", "G10 Swaps London", "EMEA", 3, ["IRS", "Cross-currency Swap"]),
    ("FICC", "Rates", "G10 Swaps New York", "Americas", 3, ["IRS", "Cross-currency Swap"]),
    ("FICC", "Rates", "Govt Bonds London", "EMEA", 2, ["Govt Bond"]),
    ("FICC", "Rates", "Govt Bonds New York", "Americas", 2, ["Govt Bond"]),
    ("FICC", "Rates", "Rates Options London", "EMEA", 2, ["Swaption", "Cap/Floor", "Bermudan Swaption"]),
    ("FICC", "Rates", "EM Rates Singapore", "APAC", 2, ["EM Swap", "EM Bond"]),
    ("FICC", "Credit", "IG Credit New York", "Americas", 3, ["IG Corporate Bond", "CDS Index", "Single-name CDS"]),
    ("FICC", "Credit", "IG Credit London", "EMEA", 2, ["IG Corporate Bond", "CDS Index"]),
    ("FICC", "Credit", "HY & Distressed New York", "Americas", 2, ["HY Bond", "Distressed Loan"]),
    ("FICC", "Credit", "Structured Credit New York", "Americas", 2, ["CLO Tranche", "ABS"]),
    ("FICC", "FX", "FX Forwards London", "EMEA", 2, ["FX Forward"]),
    ("FICC", "FX", "FX Forwards Hong Kong", "APAC", 2, ["FX Forward"]),
    ("FICC", "FX", "FX Options London", "EMEA", 2, ["FX Vanilla Option", "FX Barrier Option"]),
    ("FICC", "Commodities", "Power & Gas London", "EMEA", 2, ["Power Forward", "Gas Swap"]),
    ("FICC", "Commodities", "Metals Singapore", "APAC", 1, ["Metals Forward"]),
    ("Equities", "Equity Derivatives", "Flow Vol London", "EMEA", 2, ["Index Option", "Variance Swap"]),
    ("Equities", "Equity Derivatives", "Exotics New York", "Americas", 2, ["Autocallable", "Cliquet"]),
    ("Equities", "Equity Derivatives", "Exotics Hong Kong", "APAC", 2, ["Autocallable"]),
    ("Equities", "Delta One", "Delta One New York", "Americas", 2, ["Equity Swap"]),
]
TENORS = ["< 1Y", "1-5Y", "5-10Y", "10Y+"]


def ipv_variance() -> pd.DataFrame:
    """One row per book x product x month-end. Planted stories the investigation should surface:

    - Structured Credit: April 2025 spread shock; broker quotes thin out and variances blow through tolerance.
    - EM Rates Singapore: the desk marks above IPV and the gap grows every month from mid-2025 (a mark drift).
    - Power & Gas London: January 2026 cold snap drives a one-off spike, desk marks above the street.
    - Quarter-end months are tighter everywhere because desks true up their marks before the close.
    - Fewer quote contributors and staler quotes mean bigger variances; Model proxy / L3 is noisiest.
    """
    rng = _rng(77)
    cobs = pd.date_range("2024-10-01", "2026-09-30", freq="BME")
    books = []
    for div, bl, desk, region, nbooks, prods in DESKS:
        code = "".join(w[0] for w in desk.replace("&", "").split()).upper()
        for b in range(1, nbooks + 1):
            # Each book trades a subset of the desk's products at a characteristic size and tenor.
            held = [p for p in prods if rng.random() < 0.85] or prods[:1]
            for p in held:
                level, sources, bps, tol, scale = PRODUCTS[p]
                src = rng.choice(list(sources), p=_normalized(np.array(list(sources.values()))))
                books.append((div, bl, desk, region, f"{code}-{b:02d}", p, level, src, bps, tol, scale * rng.lognormal(0, 0.5), rng.choice(TENORS)))

    rows = []
    for cob in cobs:
        quarter_end = cob.month in (3, 6, 9, 12)
        for div, bl, desk, region, book, p, level, src, bps, tol, size, tenor in books:
            exposure = size * 1e6 * rng.lognormal(0, 0.15)
            contributors = {"Consensus": 14, "Exchange": 30, "Vendor feed": 6, "Broker quote": 3.5, "Model proxy": 1}[src]
            contributors = max(1, int(rng.poisson(contributors)))
            age = float(rng.gamma(1.2, {"Broker quote": 2.5, "Model proxy": 4}.get(src, 0.6)))
            scale, bias = bps, 0.0
            if desk.startswith("Structured Credit") and cob.year == 2025 and cob.month in (4, 5):
                scale *= 4.5 if cob.month == 4 else 2.2
                bias = 0.5 * bps * (1 if cob.month == 4 else 0.5)
                contributors = max(1, contributors - 2)
                age += 6
            if desk.startswith("EM Rates") and cob >= pd.Timestamp("2025-06-01"):
                months = (cob.year - 2025) * 12 + cob.month - 6
                bias = bps * 0.35 * months
            if desk.startswith("Power") and cob.year == 2026 and cob.month == 1:
                scale *= 5
                bias = 2.5 * bps
            if quarter_end:
                scale *= 0.65
            scale *= (3 / max(contributors, 1)) ** 0.35 * (1 + age / 15)
            var_bps = bias + rng.normal(0, scale) + rng.normal(0, 0.15 * bps)
            variance = exposure * var_bps / 1e4
            mv = exposure * rng.choice([-1, 1], p=[0.3, 0.7]) * rng.uniform(0.02, 0.12)
            tolerance = exposure * tol / 1e4
            breach = abs(variance) > tolerance
            # Breaches on L2/L3 get a booked valuation adjustment toward IPV.
            adj = -variance * rng.uniform(0.6, 1.0) if breach and level != "L1" else 0.0
            rows.append(
                {
                    "cob_date": cob,
                    "division": div,
                    "business_line": bl,
                    "desk": desk,
                    "book": book,
                    "region": region,
                    "product": p,
                    "fv_level": level,
                    "ipv_source": src,
                    "tenor_bucket": tenor,
                    "ipv_status": "Breach" if breach else "Within tolerance",
                    "abs_variance_usd": round(abs(variance), 0),
                    "variance_usd": round(variance, 0),
                    "desk_mark_usd": round(mv, 0),
                    "ipv_mark_usd": round(mv - variance, 0),
                    "exposure_usd": round(exposure, 0),
                    "tolerance_usd": round(tolerance, 0),
                    "ipv_adjustment_usd": round(adj, 0),
                    "breach_count": int(breach),
                    "variance_bps": round(var_bps, 2),
                    "quote_contributors": contributors,
                    "quote_age_days": round(age, 1),
                }
            )
    return pd.DataFrame(rows)


def _normalized(w: np.ndarray) -> np.ndarray:
    return w / w.sum()


BUILTIN = {
    "retail_sales": (
        "Retail Sales",
        "4,000 orders across 3 years: timestamps, US cities with lat/lon, category → sub-category, channels, revenue, profit, ratings.",
        retail_sales,
    ),
    "weather": (
        "City Weather",
        "Daily weather for 6 US cities (2023–2025): seasonal temperatures, precipitation, wind, humidity, condition.",
        weather,
    ),
    "stocks": (
        "Stock Prices",
        "Daily OHLC + volume for 6 fictional tickers (2022–2025) with a shared market factor.",
        stocks,
    ),
    "countries": (
        "World Development",
        "Gapminder-style panel for 42 real countries 1990–2025 (ISO codes for maps; values are synthetic).",
        countries,
    ),
    "specimens": (
        "Botanical Specimens",
        "Clustered multivariate measurements for 4 species — great for scatter matrices, densities, regressions.",
        specimens,
    ),
    "network": (
        "Collaboration Network",
        "Edge list (source → target) of 32 people in 5 teams with message counts — for force graphs and arc diagrams.",
        network,
    ),
    "ipv_variance": (
        "IPV Variance",
        "Month-end independent price verification: desk marks vs IPV across division → business line → desk → book, "
        "by product, fair-value level and price source, with tolerances, breaches and adjustments (synthetic).",
        ipv_variance,
    ),
}
