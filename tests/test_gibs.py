import datetime as dt

from backend.app import gibs

XML = """<Contents><Layer><ows:Title xml:lang='en'>Precipitation Rate (IMERG)</ows:Title>
<ows:Identifier>IMERG_Precipitation_Rate</ows:Identifier>
<LegendURL xlink:href='https://gibs.earthdata.nasa.gov/legends/GPM_Precipitation_Rate_H.svg' format='image/svg+xml'/>
<Dimension><ows:Identifier>Time</ows:Identifier><Default>2026-11-13</Default>
<Value>2000-06-01/2025-10-22/P1D</Value><Value>2026-05-27/2026-11-13/P1D</Value></Dimension>
<TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level6</TileMatrixSet></TileMatrixSetLink>
<Format>image/png</Format></Layer>
<Layer><ows:Title xml:lang='en'>Snow</ows:Title><ows:Identifier>Snow_Monthly</ows:Identifier>
<Dimension><Default>2026-10-01</Default><Value>2022-11-01/2026-10-01/P1M</Value></Dimension>
<TileMatrixSetLink><TileMatrixSet>GoogleMapsCompatible_Level6</TileMatrixSet></TileMatrixSetLink>
<Format>image/png</Format></Layer></Contents>"""


def test_capabilities_and_dates():
    layers = gibs.parse_caps(XML, {"IMERG_Precipitation_Rate", "Snow_Monthly"})
    imerg = layers["IMERG_Precipitation_Rate"]
    assert imerg["period"] == "P1D" and imerg["tms"] == "GoogleMapsCompatible_Level6" and imerg["ext"] == "png"
    assert imerg["legend"].endswith("GPM_Precipitation_Rate_H.svg")
    today = dt.date(2026, 11, 13)
    assert gibs.pick_date(imerg, today) == "2026-11-12"  # today's swaths are still filling in
    assert gibs.pick_date(layers["Snow_Monthly"], today) == "2026-10-01"
