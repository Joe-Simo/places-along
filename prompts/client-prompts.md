# Prompts for Cursor and Claude Code with the Geoapify MCP server

Connect the server first (see the tutorial, Part A). These prompts are the ones the tutorial uses.

## Check the connection

```text
Use the Geoapify tools to geocode "Lawrence, KS". Return the formatted address and the coordinates, and tell me which tool you called.
```

## 1. The trip question

```text
Using only the Geoapify tools: I'm driving from Lawrence, KS to Denver, CO.
Where can I stop for coffee and EV charging about every two hours?

Work like this:
1. Geocode both places with geocode_address.
2. Get a driving route with calculate_route (geometry_format "geojson").
   It returns a MultiLineString. measure_geometry "along" only accepts a LineString,
   so pass {"type": "LineString", "coordinates": <the route's first and only line>}.
3. Work out the points along the route at 2 h, 4 h, 6 h, and so on (stop no later than
   20 minutes before arrival), using measure_geometry with operation "along".
4. At each point, search with search_places for category "catering.cafe" and for
   "service.vehicle.charging_station", radius_meters 50000.
5. For each stop, pick the closest good option of each kind.

Answer with a numbered stop list: stop time, place name, town, and the tool call each pick came from.
Never name a place that a tool did not return.
```

## 2. Show your work

```text
List every Geoapify tool call you made, in order, with its arguments (shorten long coordinate arrays),
and for each stop say which search_places call returned it.
```

## 3. Change one thing

```text
Same trip, but I also want a proper meal at the stop closest to the halfway point.
Use search_places with "catering.restaurant" there, and keep everything else the same.
```

## 4. When a category is unknown

```text
Before searching, call list_place_categories and tell me which exact category keys fit
"a place to rest on a road trip". Then use them for the stops in my last trip.
```
