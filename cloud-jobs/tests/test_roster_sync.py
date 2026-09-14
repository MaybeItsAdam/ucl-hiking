from hiking_sync.roster_sync import membership_end, parse_members_page


def row(name: str, end_attr: bool = True) -> str:
    end = '<time datetime="2027-08-30T22:59:59Z" class="datetime">30/08/2027</time>' if end_attr else '<time class="datetime">30/08/2027</time>'
    return f"""
    <tr>
      <td class="views-field views-field-field-full-name"> {name} </td>
      <td class="views-field views-field-roles-target-id"> Student member </td>
      <td class="views-field views-field-field-membership-type"> Taster </td>
      <td class="views-field views-field-date-range__value"><time class="datetime">14/09/2026</time> - {end}</td>
      <td class="views-field views-field-over-18"> Yes </td>
    </tr>"""


def page(rows: list[str], next_page: bool = False) -> str:
    pager = '<li class="pager__item pager__item--next"><a href="?page=1">Next</a></li>' if next_page else ""
    return f'<table class="views-table views-view-table cols-5"><tbody>{"".join(rows)}</tbody></table><ul>{pager}</ul>'


def test_parses_columns_by_class_and_drops_over_18() -> None:
    members, has_next, recognised = parse_members_page(page([row("Ada O&#039;Lovelace")], next_page=True))
    assert recognised and has_next
    assert members == [
        {
            "fullName": "Ada O'Lovelace",
            "memberType": "Student member",
            "membershipType": "Taster",
            "membershipExpiresAt": "2027-08-30T22:59:59+00:00",
        }
    ]


def test_end_date_without_datetime_attribute_is_end_of_day_in_london() -> None:
    members, _, _ = parse_members_page(page([row("Ada Lovelace", end_attr=False)]))
    assert members[0]["membershipExpiresAt"] == "2027-08-30T22:59:59+00:00"
    assert membership_end('<time class="datetime">15/01/2027</time> - <time class="datetime">15/01/2027</time>') == "2027-01-15T23:59:59+00:00"


def test_login_page_is_not_recognised() -> None:
    members, has_next, recognised = parse_members_page('<form id="user-login-form"></form>')
    assert (members, has_next, recognised) == ([], False, False)
